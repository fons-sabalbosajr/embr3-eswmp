import { useState, useEffect, useCallback, useMemo } from "react";
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
  Progress,
  Badge,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  ApartmentOutlined,
  DownloadOutlined,
  SearchOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  LinkOutlined,
  ReloadOutlined,
  TeamOutlined,
  CalendarOutlined,
  UserOutlined,
  SolutionOutlined,
  AuditOutlined,
  GlobalOutlined,
  ClockCircleOutlined,
  SafetyCertificateOutlined,
  BarChartOutlined,
  FilterOutlined,
  ClearOutlined,
  ToolOutlined,
  BankOutlined,
  FundOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import secureStorage from "../../utils/secureStorage";
import { useDataRef } from "../../utils/dataRef";
import dayjs from "dayjs";

const { Title, Text } = Typography;

const CACHE_KEY = "lgu-mrf-cache";
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
  let count = 0;
  let cur = s;
  const dir = e.isAfter(s) ? 1 : -1;
  while (dir > 0 ? !cur.isAfter(e) : !cur.isBefore(e)) {
    const dow = cur.day();
    if (dow !== 0 && dow !== 6) count++;
    cur = cur.add(dir, "day");
  }
  return Math.max(1, count > 1 ? count - 1 : count);
}

function computeFields(rec) {
  const computed = {};
  computed.totalDaysReportPrepared = networkDays(rec.dateOfMonitoring, rec.dateReportPrepared);
  computed.totalDaysReviewedStaff = networkDays(rec.dateReportPrepared, rec.dateReportReviewedStaff);
  computed.totalDaysReviewedFocal = networkDays(rec.dateReportReviewedStaff || rec.dateReportPrepared, rec.dateReportReviewedFocal);
  computed.totalDaysApproved = networkDays(rec.dateReportReviewedFocal, rec.dateReportApproved);
  return computed;
}

function getStatusTag(v) {
  if (!v) return <Tag color="default">—</Tag>;
  if (/operational/i.test(v) && !/non/i.test(v)) return <Tag color="green" bordered={false}><CheckCircleOutlined /> Operational</Tag>;
  if (/non/i.test(v)) return <Tag color="red" bordered={false}><CloseCircleOutlined /> Non-Operational</Tag>;
  return <Tag bordered={false}>{v}</Tag>;
}

export default function LguInitiatedMRF() {
  const { getValues } = useDataRef();
  const provinceOptions = getValues("province").map((p) => ({ label: p, value: p }));
  const monthOptions = getValues("target-month").map((m) => ({ label: m.replace(/^\d+\./, ""), value: m }));
  const mbaOptions = getValues("manila-bay-area").map((v) => ({ label: v, value: v }));
  const mrfStatusOptions = getValues("mrf-status").map((v) => ({ label: v, value: v }));
  const lguMrfTypeOptions = getValues("lgu-mrf-type").map((v) => ({ label: v, value: v }));
  const enmoOptions = getValues("enmo").map((v) => ({ label: v, value: v }));
  const eswmStaffOptions = getValues("eswm-staff").map((v) => ({ label: v, value: v }));
  const focalOptions = getValues("eswm-focal").map((v) => ({ label: v, value: v }));

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailModal, setDetailModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [filterProvince, setFilterProvince] = useState(null);
  const [filterMBA, setFilterMBA] = useState(null);
  const [filterStatus, setFilterStatus] = useState(null);
  const [filterType, setFilterType] = useState(null);
  const [filterMonth, setFilterMonth] = useState(null);
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
      const { data } = await api.get("/lgu-initiated-mrf");
      const enriched = data.map((r) => ({ ...r, ...computeFields(r) }));
      setRecords(enriched);
      secureStorage.setJSON(CACHE_KEY, { data, ts: Date.now() });
    } catch {
      Swal.fire("Error", "Failed to load records", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const openAdd = () => { setEditing(null); form.resetFields(); setModalOpen(true); };

  const openEdit = (record) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      dateOfMonitoring: record.dateOfMonitoring ? dayjs(record.dateOfMonitoring) : null,
      dateReportPrepared: record.dateReportPrepared ? dayjs(record.dateReportPrepared) : null,
      dateReportReviewedStaff: record.dateReportReviewedStaff ? dayjs(record.dateReportReviewedStaff) : null,
      dateReportReviewedFocal: record.dateReportReviewedFocal ? dayjs(record.dateReportReviewedFocal) : null,
      dateReportApproved: record.dateReportApproved ? dayjs(record.dateReportApproved) : null,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        ...values,
        dateOfMonitoring: values.dateOfMonitoring?.toISOString(),
        dateReportPrepared: values.dateReportPrepared?.toISOString(),
        dateReportReviewedStaff: values.dateReportReviewedStaff?.toISOString(),
        dateReportReviewedFocal: values.dateReportReviewedFocal?.toISOString(),
        dateReportApproved: values.dateReportApproved?.toISOString(),
      };
      Object.assign(payload, computeFields(payload));
      if (editing) {
        const { data } = await api.put(`/lgu-initiated-mrf/${editing._id}`, payload);
        setRecords((prev) => prev.map((r) => r._id === editing._id ? { ...data, ...computeFields(data) } : r));
        secureStorage.remove(CACHE_KEY);
        Swal.fire("Updated", "Record updated successfully", "success");
      } else {
        await api.post("/lgu-initiated-mrf", payload);
        secureStorage.remove(CACHE_KEY);
        Swal.fire("Created", "Record added successfully", "success");
        fetchRecords();
      }
    } catch (err) {
      if (err.response) Swal.fire("Error", err.response.data?.message || "Save failed", "error");
    }
    setModalOpen(false);
  };

  const handleDelete = (record) => {
    Swal.fire({
      title: "Delete this record?",
      text: `${record.municipality}, ${record.province}`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ff4d4f",
      confirmButtonText: "Delete",
    }).then(async (result) => {
      if (result.isConfirmed) {
        await api.delete(`/lgu-initiated-mrf/${record._id}`);
        secureStorage.remove(CACHE_KEY);
        setRecords((prev) => prev.filter((r) => r._id !== record._id));
        Swal.fire("Deleted", "Record deleted", "success");
      }
    });
  };

  // Filtering
  const hasActiveFilters = filterProvince || filterMBA || filterStatus || filterType || filterMonth || searchText;
  const clearAllFilters = () => { setFilterProvince(null); setFilterMBA(null); setFilterStatus(null); setFilterType(null); setFilterMonth(null); setSearchText(""); };

  const filtered = useMemo(() => {
    let data = records;
    if (searchText) {
      const s = searchText.toLowerCase();
      data = data.filter((r) =>
        [r.province, r.municipality, r.barangay, r.focalPerson, r.enmoAssigned, r.typeOfMRF, r.statusOfMRF, r.fundingSource]
          .some((v) => v && v.toLowerCase().includes(s))
      );
    }
    if (filterProvince) data = data.filter((r) => r.province === filterProvince);
    if (filterMBA) data = data.filter((r) => r.manilaBayArea === filterMBA);
    if (filterStatus) {
      if (filterStatus === "Operational") data = data.filter((r) => /operational/i.test(r.statusOfMRF) && !/non/i.test(r.statusOfMRF));
      else if (filterStatus === "Non-Operational") data = data.filter((r) => /non/i.test(r.statusOfMRF));
      else data = data.filter((r) => !r.statusOfMRF);
    }
    if (filterType) data = data.filter((r) => r.typeOfMRF === filterType);
    if (filterMonth) data = data.filter((r) => r.targetMonth === filterMonth);
    return data;
  }, [records, searchText, filterProvince, filterMBA, filterStatus, filterType, filterMonth]);

  const filters = useMemo(() => ({
    province: buildFilters(records, "province"),
    manilaBayArea: buildFilters(records, "manilaBayArea"),
    typeOfMRF: buildFilters(records, "typeOfMRF"),
    statusOfMRF: buildFilters(records, "statusOfMRF"),
    focalPerson: buildFilters(records, "focalPerson"),
    targetMonth: buildFilters(records, "targetMonth"),
    barangay: buildFilters(records, "barangay"),
    fundingSource: buildFilters(records, "fundingSource"),
  }), [records]);

  const typeOptions = useMemo(() => {
    const types = [...new Set(records.map((r) => r.typeOfMRF).filter(Boolean))].sort();
    return types.map((t) => ({ label: t, value: t }));
  }, [records]);

  const columns = [
    {
      title: <><EnvironmentOutlined style={{ color: "#1a3353" }} /> LGU</>,
      key: "lgu", width: 140, fixed: "left",
      filters: filters.province,
      onFilter: (v, r) => r.province === v,
      sorter: (a, b) => (a.municipality || "").localeCompare(b.municipality || ""),
      render: (_, r) => (
        <Tooltip title={`${r.province} — ${r.municipality}${r.barangay ? ` (${r.barangay})` : ""}`}>
          <div style={{ lineHeight: 1.3 }}>
            <Text strong style={{ fontSize: 12 }}>{r.municipality}</Text><br />
            <Text type="secondary" style={{ fontSize: 11 }}>{r.province}{r.barangay ? ` · ${r.barangay}` : ""}</Text>
          </div>
        </Tooltip>
      ),
    },
    {
      title: "MBA", dataIndex: "manilaBayArea", key: "mba", width: 90,
      filters: filters.manilaBayArea,
      onFilter: (v, r) => r.manilaBayArea === v,
      render: (v) => v === "MBA" ? <Tag color="blue" bordered={false}>MBA</Tag> : <Tag color="default" bordered={false}>{v || "—"}</Tag>,
    },
    {
      title: <><ApartmentOutlined style={{ color: "#13c2c2" }} /> MRF Type</>,
      dataIndex: "typeOfMRF", key: "typeOfMRF", width: 150,
      filters: filters.typeOfMRF,
      onFilter: (v, r) => r.typeOfMRF === v,
      render: (v) => v ? <Tag color="cyan" bordered={false}>{v}</Tag> : <Text type="secondary">—</Text>,
    },
    {
      title: <><FundOutlined style={{ color: "#722ed1" }} /> Funding</>,
      key: "funding", width: 140,
      sorter: (a, b) => (a.estimatedCost || 0) - (b.estimatedCost || 0),
      render: (_, r) => (
        <div style={{ lineHeight: 1.3 }}>
          <Text strong style={{ fontSize: 12 }}>{r.estimatedCost != null ? `₱${r.estimatedCost.toLocaleString()}` : "—"}</Text><br />
          <Text type="secondary" style={{ fontSize: 10 }}>{r.fundingSource || "—"}</Text>
        </div>
      ),
    },
    {
      title: <><CalendarOutlined style={{ color: "#1890ff" }} /> Year Est.</>,
      dataIndex: "yearEstablished", key: "yearEstablished", width: 90,
      sorter: (a, b) => (a.yearEstablished || 0) - (b.yearEstablished || 0),
      render: (v) => v || "—",
    },
    {
      title: "Status", dataIndex: "statusOfMRF", key: "status", width: 120,
      filters: filters.statusOfMRF,
      onFilter: (v, r) => r.statusOfMRF === v,
      render: (v) => getStatusTag(v),
    },
    {
      title: <><TeamOutlined style={{ color: "#722ed1" }} /> Personnel</>,
      key: "personnel", width: 190,
      filters: filters.focalPerson, filterSearch: true,
      onFilter: (v, r) => r.focalPerson === v,
      render: (_, r) => (
        <Tooltip title={<div><div><UserOutlined /> Focal: {r.focalPerson || "—"}</div><div><UserOutlined /> Staff: {r.eswmStaff || "—"}</div><div><SolutionOutlined /> ENMO: {r.enmoAssigned || "—"}</div></div>}>
          <div style={{ lineHeight: 1.3 }}>
            <Text style={{ fontSize: 11 }}><UserOutlined style={{ color: "#722ed1", marginRight: 4 }} />{r.focalPerson || "—"}</Text><br />
            <Text type="secondary" style={{ fontSize: 10 }}><SolutionOutlined style={{ marginRight: 3 }} />{r.enmoAssigned || "—"}</Text>
          </div>
        </Tooltip>
      ),
    },
    {
      title: "Target Month", dataIndex: "targetMonth", key: "targetMonth", width: 110,
      filters: filters.targetMonth,
      onFilter: (v, r) => r.targetMonth === v,
      render: (v) => v ? <Tag bordered={false} color="cyan">{v.replace(/^\d+\./, "")}</Tag> : "—",
    },
    {
      title: "Brgy Served", dataIndex: "noOfBrgyServed", key: "brgyServed", width: 100,
      sorter: (a, b) => (a.noOfBrgyServed || 0) - (b.noOfBrgyServed || 0),
      render: (v) => v != null ? <Tag bordered={false}>{v}</Tag> : "—",
    },
    {
      title: "Diversion Rate", key: "diversionRate", width: 130,
      sorter: (a, b) => (a.wasteDiversionRate || 0) - (b.wasteDiversionRate || 0),
      render: (_, r) => {
        const v = r.wasteDiversionRate;
        if (v == null) return <Tag color="default">—</Tag>;
        const pct = Math.round(v * (v > 1 ? 1 : 100));
        return <Progress percent={pct} size="small" strokeColor={pct >= 50 ? "#52c41a" : pct >= 25 ? "#faad14" : "#ff4d4f"} format={() => `${pct}%`} style={{ width: 100 }} />;
      },
    },
    {
      title: "Actions", key: "actions", width: 80, fixed: "right",
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title="View Details"><Button type="text" size="small" icon={<EyeOutlined style={{ color: "#1890ff" }} />} onClick={() => setDetailModal(record)} /></Tooltip>
          <Tooltip title="Edit"><Button type="text" size="small" icon={<EditOutlined style={{ color: "#52c41a" }} />} onClick={() => openEdit(record)} /></Tooltip>
        </Space>
      ),
    },
  ];

  // Summary stats
  const operationalCount = filtered.filter((r) => /operational/i.test(r.statusOfMRF) && !/non/i.test(r.statusOfMRF)).length;
  const nonOperationalCount = filtered.filter((r) => /non/i.test(r.statusOfMRF)).length;
  const totalCost = filtered.reduce((s, r) => s + (r.estimatedCost || 0), 0);
  const avgDiversion = filtered.length > 0 ? filtered.reduce((s, r) => s + (r.wasteDiversionRate || 0), 0) / filtered.length : 0;
  const normalizedAvgDiversion = avgDiversion > 1 ? avgDiversion : avgDiversion * 100;
  const mbaCount = filtered.filter((r) => r.manilaBayArea === "MBA").length;
  const provinceCount = new Set(filtered.map((r) => r.province).filter(Boolean)).size;
  const totalBrgyServed = filtered.reduce((s, r) => s + (r.noOfBrgyServed || 0), 0);
  const operationalRate = filtered.length > 0 ? (operationalCount / filtered.length) * 100 : 0;

  return (
    <div>
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        @keyframes subtleBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        .lgu-mrf-card { animation: fadeInUp 0.5s ease-out both; }
        .lgu-mrf-tag-pulse { animation: pulse 2.5s ease-in-out infinite; }
        .lgu-mrf-icon-bounce { display: inline-block; transition: transform 0.2s; cursor: default; }
        .lgu-mrf-icon-bounce:hover { animation: subtleBounce 0.4s ease; }
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <Title level={4} style={{ margin: 0 }}><ApartmentOutlined /> LGU Initiated MRF</Title>
        <Space wrap>
          <Input placeholder="Search..." prefix={<SearchOutlined />} value={searchText} onChange={(e) => setSearchText(e.target.value)} style={{ width: "100%", maxWidth: 200 }} allowClear />
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>Add Record</Button>
          <Button icon={<DownloadOutlined />} onClick={() => {
            const rows = filtered.map((r) => ({
              Province: r.province, Municipality: r.municipality, Barangay: r.barangay,
              "Manila Bay Area": r.manilaBayArea, "Congressional District": r.congressionalDistrict,
              "Type of MRF": r.typeOfMRF, "Year Established": r.yearEstablished,
              "Estimated Cost": r.estimatedCost, "Funding Source": r.fundingSource,
              "ENMO Assigned": r.enmoAssigned, "ESWM Staff": r.eswmStaff, "Focal Person": r.focalPerson,
              "Target Month": r.targetMonth, "IIS Number": r.iisNumber,
              "Date of Monitoring": r.dateOfMonitoring ? dayjs(r.dateOfMonitoring).format("MMM DD, YYYY") : "",
              "No. of Brgy Served": r.noOfBrgyServed, "Equipment Used": r.equipmentUsed,
              "Type of Wastes Received": r.typeOfWastesReceived,
              "Quantity Diverted (kg)": r.quantityOfWasteDiverted,
              "Total Waste Generation (kg/day)": r.totalWasteGeneration,
              "Waste Diversion Rate (%)": r.wasteDiversionRate,
              "Status of MRF": r.statusOfMRF, "Remarks": r.remarksIfNotOperational,
              "Compliance": r.remarksAndRecommendation,
            }));
            exportToExcel(rows, "LGU_Initiated_MRF");
          }}>Export</Button>
          <Tooltip title="Refresh data"><Button icon={<ReloadOutlined />} onClick={() => fetchRecords(true)} loading={loading} /></Tooltip>
        </Space>
      </div>

      {/* Filter Bar */}
      <Card size="small" style={{ borderRadius: 10, marginBottom: 12 }} bodyStyle={{ padding: "10px 16px" }}>
        <Row gutter={[10, 10]} align="middle">
          <Col><FilterOutlined style={{ color: "#13c2c2", marginRight: 6 }} /><Text type="secondary" style={{ fontSize: 12 }}>Filters:</Text></Col>
          <Col flex="auto">
            <Space wrap size={8}>
              <Select placeholder="Province" value={filterProvince} onChange={setFilterProvince} allowClear style={{ width: "100%", minWidth: 120, maxWidth: 160 }} size="small" options={provinceOptions} suffixIcon={<EnvironmentOutlined />} />
              <Select placeholder="MBA" value={filterMBA} onChange={setFilterMBA} allowClear style={{ width: "100%", minWidth: 100, maxWidth: 140 }} size="small" options={mbaOptions} />
              <Select placeholder="MRF Type" value={filterType} onChange={setFilterType} allowClear style={{ width: "100%", minWidth: 130, maxWidth: 180 }} size="small" options={typeOptions.length > 0 ? typeOptions : lguMrfTypeOptions} suffixIcon={<ApartmentOutlined />} />
              <Select placeholder="Status" value={filterStatus} onChange={setFilterStatus} allowClear style={{ width: "100%", minWidth: 110, maxWidth: 160 }} size="small" options={mrfStatusOptions} suffixIcon={<AuditOutlined />} />
              <Select placeholder="Target Month" value={filterMonth} onChange={setFilterMonth} allowClear style={{ width: "100%", minWidth: 110, maxWidth: 150 }} size="small" options={monthOptions} suffixIcon={<CalendarOutlined />} />
              {hasActiveFilters && <Tooltip title="Clear all filters"><Button size="small" type="link" danger icon={<ClearOutlined />} onClick={clearAllFilters}>Clear</Button></Tooltip>}
            </Space>
          </Col>
          <Col><Tag bordered={false} color={hasActiveFilters ? "cyan" : "default"}>{filtered.length} / {records.length} records</Tag></Col>
        </Row>
      </Card>

      {/* Summary Dashboard Tiles */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="lgu-mrf-card" style={{ borderRadius: 10, borderLeft: "3px solid #13c2c2", height: "100%" }}>
            <Statistic title="Total LGU MRFs" value={filtered.length} prefix={<ApartmentOutlined className="lgu-mrf-icon-bounce" style={{ color: "#13c2c2" }} />} />
            <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
              <Tag color="blue" bordered={false}>MBA {mbaCount}</Tag>
              <Tag bordered={false}>Non-MBA {filtered.length - mbaCount}</Tag>
              <Tag color="purple" bordered={false}>{provinceCount} Provinces</Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="lgu-mrf-card" style={{ borderRadius: 10, borderLeft: "3px solid #52c41a", height: "100%", animationDelay: "0.07s" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <Statistic title="Operational Rate" value={operationalRate.toFixed(1)} suffix="%" prefix={<CheckCircleOutlined className="lgu-mrf-icon-bounce" style={{ color: "#52c41a" }} />} />
              <Progress type="circle" percent={Math.round(operationalRate)} size={48} strokeColor={{ "0%": "#52c41a", "100%": "#87d068" }} />
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
              <Tag color="green" bordered={false} className="lgu-mrf-tag-pulse"><CheckCircleOutlined /> {operationalCount}</Tag>
              <Tag color="red" bordered={false} className="lgu-mrf-tag-pulse"><CloseCircleOutlined /> {nonOperationalCount}</Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="lgu-mrf-card" style={{ borderRadius: 10, borderLeft: "3px solid #1890ff", height: "100%", animationDelay: "0.14s" }}>
            <Statistic title="Avg. Diversion Rate" value={normalizedAvgDiversion.toFixed(1)} suffix="%" prefix={<BarChartOutlined className="lgu-mrf-icon-bounce" style={{ color: "#1890ff" }} />} />
            <Progress percent={Math.round(normalizedAvgDiversion)} size="small" strokeColor={normalizedAvgDiversion >= 50 ? "#52c41a" : normalizedAvgDiversion >= 25 ? "#faad14" : "#ff4d4f"} style={{ marginTop: 8 }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="lgu-mrf-card" style={{ borderRadius: 10, borderLeft: "3px solid #722ed1", height: "100%", animationDelay: "0.21s" }}>
            <Statistic title="Total Estimated Cost" value={totalCost} prefix={<span className="lgu-mrf-icon-bounce" style={{ color: "#722ed1", fontWeight: 700, fontSize: 18 }}>₱</span>} formatter={(v) => Number(v).toLocaleString()} />
            <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
              <Tag color="cyan" bordered={false}>{totalBrgyServed} Brgys Served</Tag>
            </div>
          </Card>
        </Col>
      </Row>

      {/* Table */}
      <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: 0 }}>
        <Table
          dataSource={filtered}
          columns={columns}
          rowKey="_id"
          size="small"
          loading={loading}
          scroll={{ x: 1400 }}
          pagination={{ defaultPageSize: 15, pageSizeOptions: ["10", "15", "25", "50", "100"], showSizeChanger: true, showTotal: (t, r) => `${r[0]}-${r[1]} of ${t}` }}
        />
      </Card>

      {/* Detail Modal */}
      <Modal
        title={<Space><FileTextOutlined />{detailModal?.municipality}, {detailModal?.province}</Space>}
        open={!!detailModal}
        onCancel={() => setDetailModal(null)}
        footer={<Button onClick={() => setDetailModal(null)}>Close</Button>}
        width={800}
        style={{ maxWidth: "95vw" }}
      >
        {detailModal && (
          <Tabs items={[
            { key: "general", label: <><EnvironmentOutlined /> General Info</>, children: (
              <>
                <Row gutter={[16, 12]}>
                  <Col xs={24} sm={12}><Text type="secondary"><EnvironmentOutlined /> Province:</Text> <Text strong>{detailModal.province}</Text></Col>
                  <Col xs={24} sm={12}><Text type="secondary"><EnvironmentOutlined /> Municipality:</Text> <Text strong>{detailModal.municipality}</Text></Col>
                  <Col xs={24} sm={12}><Text type="secondary">Barangay:</Text> <Text>{detailModal.barangay || "—"}</Text></Col>
                  <Col xs={24} sm={12}><Text type="secondary">Manila Bay Area:</Text> {detailModal.manilaBayArea === "MBA" ? <Tag color="blue" bordered={false}>MBA</Tag> : <Tag color="default" bordered={false}>{detailModal.manilaBayArea || "—"}</Tag>}</Col>
                  <Col xs={24} sm={12}><Text type="secondary">Congressional District:</Text> <Text>{detailModal.congressionalDistrict || "—"}</Text></Col>
                  <Col xs={24} sm={12}><Text type="secondary">Coordinates:</Text> <Text>{detailModal.latitude}, {detailModal.longitude}</Text></Col>
                </Row>
                <Divider plain orientation="left"><ApartmentOutlined /> MRF Details</Divider>
                <Row gutter={[16, 12]}>
                  <Col xs={24} sm={12}><Text type="secondary">Type of MRF:</Text> {detailModal.typeOfMRF ? <Tag color="cyan" bordered={false}>{detailModal.typeOfMRF}</Tag> : "—"}</Col>
                  <Col xs={24} sm={12}><Text type="secondary">Year Established:</Text> <Text>{detailModal.yearEstablished || "—"}</Text></Col>
                  <Col xs={24} sm={12}><Text type="secondary">Estimated Cost:</Text> <Text strong>{detailModal.estimatedCost != null ? `₱${detailModal.estimatedCost.toLocaleString()}` : "—"}</Text></Col>
                  <Col xs={24} sm={12}><Text type="secondary">Funding Source:</Text> <Text>{detailModal.fundingSource || "—"}</Text></Col>
                  <Col xs={24} sm={12}><Text type="secondary">Status:</Text> {getStatusTag(detailModal.statusOfMRF)}</Col>
                  <Col xs={24} sm={12}><Text type="secondary">Brgys Served:</Text> <Text>{detailModal.noOfBrgyServed || "—"}</Text></Col>
                </Row>
                <Divider plain orientation="left"><TeamOutlined /> Personnel</Divider>
                <Row gutter={[16, 12]}>
                  <Col xs={24} sm={8}><Text type="secondary"><UserOutlined /> Focal Person:</Text><br /><Text strong>{detailModal.focalPerson || "—"}</Text></Col>
                  <Col xs={24} sm={8}><Text type="secondary"><UserOutlined /> ESWM Staff:</Text><br /><Text strong>{detailModal.eswmStaff || "—"}</Text></Col>
                  <Col xs={24} sm={8}><Text type="secondary"><TeamOutlined /> ENMO Assigned:</Text><br /><Text strong>{detailModal.enmoAssigned || "—"}</Text></Col>
                </Row>
                {detailModal.signedDocument && (<>
                  <Divider plain orientation="left"><LinkOutlined /> Document</Divider>
                  <a href={detailModal.signedDocument} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 12px", background: "#e6f7ff", borderRadius: 4, fontSize: 13, color: "#1890ff", textDecoration: "none", fontWeight: 600 }}><LinkOutlined /> View Signed Document</a>
                </>)}
              </>
            )},
            { key: "operations", label: <><ToolOutlined /> Operations</>, children: (
              <Row gutter={[16, 12]}>
                <Col xs={24} sm={12}><Text type="secondary">Equipment Used:</Text><br /><Text>{detailModal.equipmentUsed || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Type of Wastes Received:</Text><br /><Text>{detailModal.typeOfWastesReceived || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Quantity Diverted (kg):</Text> <Text strong>{detailModal.quantityOfWasteDiverted || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Total Waste Generation (kg/day):</Text> <Text strong>{detailModal.totalWasteGeneration != null ? detailModal.totalWasteGeneration.toLocaleString() : "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Waste Diversion Rate:</Text> <Text strong>{detailModal.wasteDiversionRate != null ? `${(detailModal.wasteDiversionRate * 100).toFixed(1)}%` : "—"}</Text></Col>
                <Col span={24}><Text type="secondary">Remarks (If Not Operational):</Text><br /><Text>{detailModal.remarksIfNotOperational || "—"}</Text></Col>
              </Row>
            )},
            { key: "monitoring", label: <><ClockCircleOutlined /> Monitoring</>, children: (
              <Row gutter={[16, 12]}>
                <Col xs={24} sm={12}><Text type="secondary">Target Month:</Text> <Text>{detailModal.targetMonth || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">IIS Number:</Text> <Text>{detailModal.iisNumber || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Date of Monitoring:</Text> <Text>{detailModal.dateOfMonitoring ? dayjs(detailModal.dateOfMonitoring).format("MMM D, YYYY") : "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Report Prepared:</Text> <Text>{detailModal.dateReportPrepared ? dayjs(detailModal.dateReportPrepared).format("MMM D, YYYY") : "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Reviewed (Staff):</Text> <Text>{detailModal.dateReportReviewedStaff ? dayjs(detailModal.dateReportReviewedStaff).format("MMM D, YYYY") : "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Reviewed (Focal):</Text> <Text>{detailModal.dateReportReviewedFocal ? dayjs(detailModal.dateReportReviewedFocal).format("MMM D, YYYY") : "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Report Approved:</Text> <Text>{detailModal.dateReportApproved ? dayjs(detailModal.dateReportApproved).format("MMM D, YYYY") : "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Tracking:</Text> <Text>{detailModal.trackingOfReports || "—"}</Text></Col>
              </Row>
            )},
            { key: "compliance", label: <><SafetyCertificateOutlined /> Compliance</>, children: (
              <Row gutter={[16, 12]}>
                <Col span={24}><Text type="secondary">Remarks & Recommendation:</Text><br /><Text>{detailModal.remarksAndRecommendation || "—"}</Text></Col>
                <Col span={24}><Text type="secondary">Findings:</Text><br /><Text>{detailModal.findings || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Advise Letter Date:</Text> <Text>{detailModal.adviseLetterDateIssued || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Compliance to Advise:</Text> <Text>{detailModal.complianceToAdvise || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Docket No. / NOV:</Text> <Text>{detailModal.docketNoNOV || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Violation:</Text> <Text>{detailModal.violation || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Date of Issuance NOV:</Text> <Text>{detailModal.dateOfIssuanceNOV || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Date of Tech Conference:</Text> <Text>{detailModal.dateOfTechnicalConference || "—"}</Text></Col>
                <Col span={24}><Text type="secondary">Commitments:</Text><br /><Text>{detailModal.commitments || "—"}</Text></Col>
              </Row>
            )},
          ]} />
        )}
      </Modal>

      {/* Add/Edit Modal */}
      <Modal
        title={editing ? "Edit LGU Initiated MRF" : "Add LGU Initiated MRF"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        width={900}
        style={{ maxWidth: "95vw" }}
        okText={editing ? "Update" : "Create"}
      >
        <Form form={form} layout="vertical" size="small">
          <Collapse defaultActiveKey={["location","mrf","personnel","monitoring","compliance"]} bordered={false} items={[
            { key: "location", label: <span style={{ color: "#1677ff" }}><EnvironmentOutlined /> Location</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={12}><Form.Item name="province" label="Province" rules={[{ required: true }]}><Select options={provinceOptions} placeholder="Select Province" /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="municipality" label="Municipality" rules={[{ required: true }]}><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="barangay" label="Barangay"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="manilaBayArea" label="Manila Bay Area"><Select options={mbaOptions} allowClear /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="congressionalDistrict" label="Congressional District"><Input /></Form.Item></Col>
                <Col xs={12} sm={6}><Form.Item name="latitude" label="Latitude"><InputNumber style={{ width: "100%" }} step={0.000001} /></Form.Item></Col>
                <Col xs={12} sm={6}><Form.Item name="longitude" label="Longitude"><InputNumber style={{ width: "100%" }} step={0.000001} /></Form.Item></Col>
              </Row>
            )},
            { key: "mrf", label: <span style={{ color: "#fa8c16" }}><ApartmentOutlined /> MRF Details</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={12}><Form.Item name="typeOfMRF" label="Type of MRF"><Select options={lguMrfTypeOptions} allowClear placeholder="Select Type" /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="fundingSource" label="Funding Source"><Input placeholder="e.g. LGU Fund, DILG, PPP" /></Form.Item></Col>
                <Col xs={12} sm={6}><Form.Item name="yearEstablished" label="Year Established"><InputNumber style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="estimatedCost" label="Estimated Cost (₱)"><InputNumber style={{ width: "100%" }} formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} parser={(v) => v.replace(/,/g, "")} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="statusOfMRF" label="Status of MRF"><Select options={mrfStatusOptions} allowClear /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="noOfBrgyServed" label="No. of Brgys Served"><InputNumber style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="equipmentUsed" label="Equipment Used"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="typeOfWastesReceived" label="Type of Wastes Received"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="quantityOfWasteDiverted" label="Quantity Diverted (kg)"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="totalWasteGeneration" label="Total Waste Generation (kg/day)"><InputNumber style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="wasteDiversionRate" label="Waste Diversion Rate (%)"><InputNumber style={{ width: "100%" }} step={0.01} min={0} max={1} /></Form.Item></Col>
              </Row>
            )},
            { key: "personnel", label: <span style={{ color: "#52c41a" }}><TeamOutlined /> Personnel</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={8}><Form.Item name="enmoAssigned" label="ENMO Assigned"><Select options={enmoOptions} allowClear showSearch placeholder="Select ENMO" /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="eswmStaff" label="ESWM Staff"><Select options={eswmStaffOptions} allowClear showSearch placeholder="Select Staff" /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="focalPerson" label="Focal Person"><Select options={focalOptions} allowClear showSearch placeholder="Select Focal" /></Form.Item></Col>
              </Row>
            )},
            { key: "monitoring", label: <span style={{ color: "#13c2c2" }}><CalendarOutlined /> Monitoring</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={8}><Form.Item name="targetMonth" label="Target Month"><Select options={monthOptions} allowClear /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="iisNumber" label="IIS Number"><Input /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateOfMonitoring" label="Date of Monitoring"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateReportPrepared" label="Report Prepared"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateReportReviewedStaff" label="Reviewed (Staff)"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateReportReviewedFocal" label="Reviewed (Focal)"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateReportApproved" label="Report Approved"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={16}><Form.Item name="trackingOfReports" label="Tracking of Reports"><Input /></Form.Item></Col>
              </Row>
            )},
            { key: "compliance", label: <span style={{ color: "#eb2f96" }}><SafetyCertificateOutlined /> Compliance</span>, children: (
              <Row gutter={16}>
                <Col span={24}><Form.Item name="remarksAndRecommendation" label="Remarks & Recommendation"><Input.TextArea rows={2} /></Form.Item></Col>
                <Col span={24}><Form.Item name="remarksIfNotOperational" label="Remarks (If Not Operational)"><Input.TextArea rows={2} /></Form.Item></Col>
                <Col span={24}><Form.Item name="findings" label="Findings"><Input.TextArea rows={2} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="adviseLetterDateIssued" label="Advise Letter Date"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="complianceToAdvise" label="Compliance to Advise"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="docketNoNOV" label="Docket No. / NOV"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="violation" label="Violation"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="dateOfIssuanceNOV" label="Date of Issuance NOV"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="dateOfTechnicalConference" label="Date of Tech Conference"><Input /></Form.Item></Col>
                <Col span={24}><Form.Item name="commitments" label="Commitments"><Input.TextArea rows={2} /></Form.Item></Col>
                <Col span={24}><Form.Item name="signedDocument" label="Signed Document URL"><Input /></Form.Item></Col>
              </Row>
            )},
          ]} />
        </Form>
      </Modal>
    </div>
  );
}
