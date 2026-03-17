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
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  ExperimentOutlined,
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
  UserOutlined,
  SolutionOutlined,
  ClockCircleOutlined,
  BarChartOutlined,
  FilterOutlined,
  ClearOutlined,
  ToolOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  CompassOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import secureStorage from "../../utils/secureStorage";
import { useDataRef } from "../../utils/dataRef";
import dayjs from "dayjs";

const { Title, Text } = Typography;

const CACHE_KEY = "trash-trap-cache";
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
  let count = 0, cur = s;
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
    totalDaysReportPrepared: networkDays(rec.dateOfMonitoring, rec.dateReportPrepared),
    totalDaysReviewedStaff: networkDays(rec.dateReportPrepared, rec.dateReportReviewedStaff),
    totalDaysReviewedFocal: networkDays(rec.dateReportReviewedStaff || rec.dateReportPrepared, rec.dateReportReviewedFocal),
    totalDaysApproved: networkDays(rec.dateReportReviewedFocal, rec.dateReportApproved),
  };
}

function getStatusTag(v) {
  if (!v) return <Tag color="default">—</Tag>;
  if (/operational/i.test(v) && !/non/i.test(v)) return <Tag color="green" bordered={false}><CheckCircleOutlined /> Operational</Tag>;
  if (/non/i.test(v)) return <Tag color="red" bordered={false}><CloseCircleOutlined /> Non-Operational</Tag>;
  return <Tag bordered={false}>{v}</Tag>;
}

export default function TrashTraps() {
  const { getValues } = useDataRef();
  const provinceOptions = getValues("province").map((p) => ({ label: p, value: p }));
  const monthOptions = getValues("target-month").map((m) => ({ label: m.replace(/^\d+\./, ""), value: m }));
  const mbaOptions = getValues("manila-bay-area").map((v) => ({ label: v, value: v }));
  const trashTrapStatusOptions = getValues("trash-trap-status").map((v) => ({ label: v, value: v }));
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
      const { data } = await api.get("/trash-traps");
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
      dateInstalled: record.dateInstalled ? dayjs(record.dateInstalled) : null,
      dateOfMonitoring: record.dateOfMonitoring ? dayjs(record.dateOfMonitoring) : null,
      dateReportPrepared: record.dateReportPrepared ? dayjs(record.dateReportPrepared) : null,
      dateReportReviewedStaff: record.dateReportReviewedStaff ? dayjs(record.dateReportReviewedStaff) : null,
      dateReportReviewedFocal: record.dateReportReviewedFocal ? dayjs(record.dateReportReviewedFocal) : null,
      dateReportApproved: record.dateReportApproved ? dayjs(record.dateReportApproved) : null,
      dateOfLastHauling: record.dateOfLastHauling ? dayjs(record.dateOfLastHauling) : null,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        ...values,
        dateInstalled: values.dateInstalled?.toISOString(),
        dateOfMonitoring: values.dateOfMonitoring?.toISOString(),
        dateReportPrepared: values.dateReportPrepared?.toISOString(),
        dateReportReviewedStaff: values.dateReportReviewedStaff?.toISOString(),
        dateReportReviewedFocal: values.dateReportReviewedFocal?.toISOString(),
        dateReportApproved: values.dateReportApproved?.toISOString(),
        dateOfLastHauling: values.dateOfLastHauling?.toISOString(),
      };
      Object.assign(payload, computeFields(payload));
      if (editing) {
        const { data } = await api.put(`/trash-traps/${editing._id}`, payload);
        setRecords((prev) => prev.map((r) => r._id === editing._id ? { ...data, ...computeFields(data) } : r));
        secureStorage.remove(CACHE_KEY);
        Swal.fire("Updated", "Record updated successfully", "success");
      } else {
        await api.post("/trash-traps", payload);
        secureStorage.remove(CACHE_KEY);
        Swal.fire("Created", "Record added successfully", "success");
        fetchRecords();
      }
    } catch (err) {
      if (err.response) Swal.fire("Error", err.response.data?.message || "Save failed", "error");
    }
    setModalOpen(false);
  };

  const hasActiveFilters = filterProvince || filterMBA || filterStatus || filterMonth || searchText;
  const clearAllFilters = () => { setFilterProvince(null); setFilterMBA(null); setFilterStatus(null); setFilterMonth(null); setSearchText(""); };

  const filtered = useMemo(() => {
    let data = records;
    if (searchText) {
      const q = searchText.toLowerCase();
      data = data.filter((r) =>
        [r.province, r.municipality, r.barangay, r.enmoAssigned, r.focalPerson]
          .some((v) => v && v.toLowerCase().includes(q))
      );
    }
    if (filterProvince) data = data.filter((r) => r.province === filterProvince);
    if (filterMBA) data = data.filter((r) => r.manilaBayArea === filterMBA);
    if (filterStatus) {
      if (filterStatus === "Operational") data = data.filter((r) => /operational/i.test(r.statusOfTrashTraps) && !/non/i.test(r.statusOfTrashTraps));
      else if (filterStatus === "Non-Operational") data = data.filter((r) => /non/i.test(r.statusOfTrashTraps));
      else data = data.filter((r) => !r.statusOfTrashTraps);
    }
    if (filterMonth) data = data.filter((r) => r.targetMonth === filterMonth);
    return data;
  }, [records, searchText, filterProvince, filterMBA, filterStatus, filterMonth]);

  const filters = useMemo(() => ({
    province: buildFilters(records, "province"),
    manilaBayArea: buildFilters(records, "manilaBayArea"),
    statusOfTrashTraps: buildFilters(records, "statusOfTrashTraps"),
    statusOfWasteLifter: buildFilters(records, "statusOfWasteLifter"),
    statusOfPlasticBoat: buildFilters(records, "statusOfPlasticBoat"),
    targetMonth: buildFilters(records, "targetMonth"),
  }), [records]);

  const operationalCount = filtered.filter((r) => /operational/i.test(r.statusOfTrashTraps) && !/non/i.test(r.statusOfTrashTraps)).length;
  const nonOperationalCount = filtered.filter((r) => /non/i.test(r.statusOfTrashTraps)).length;
  const totalHDPE = filtered.reduce((s, r) => s + (r.noOfTrashTrapsHDPE || 0), 0);
  const totalWaste = filtered.reduce((s, r) => s + (r.estimatedVolumeWasteHauled || 0), 0);
  const mbaCount = filtered.filter((r) => r.manilaBayArea === "MBA").length;
  const provinceCount = new Set(filtered.map((r) => r.province).filter(Boolean)).size;
  const operationalRate = filtered.length > 0 ? (operationalCount / filtered.length) * 100 : 0;

  const wasteLifterOp = filtered.filter((r) => /operational/i.test(r.statusOfWasteLifter) && !/non/i.test(r.statusOfWasteLifter)).length;
  const wasteLifterNonOp = filtered.filter((r) => /non/i.test(r.statusOfWasteLifter)).length;
  const plasticBoatOp = filtered.filter((r) => /operational/i.test(r.statusOfPlasticBoat) && !/non/i.test(r.statusOfPlasticBoat)).length;
  const plasticBoatNonOp = filtered.filter((r) => /non/i.test(r.statusOfPlasticBoat)).length;

  const columns = [
    {
      title: <><EnvironmentOutlined style={{ color: "#1a3353" }} /> LGU</>,
      key: "lgu", width: 160, fixed: "left",
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
      title: <><CalendarOutlined style={{ color: "#13c2c2" }} /> Installed</>,
      dataIndex: "dateInstalled", key: "dateInstalled", width: 110,
      render: (v) => v ? dayjs(v).format("MMM DD, YYYY") : "—",
      sorter: (a, b) => new Date(a.dateInstalled || 0) - new Date(b.dateInstalled || 0),
    },
    {
      title: "Status", dataIndex: "statusOfTrashTraps", key: "status", width: 130,
      filters: filters.statusOfTrashTraps,
      onFilter: (v, r) => r.statusOfTrashTraps === v,
      render: (v) => getStatusTag(v),
    },
    {
      title: <><ToolOutlined style={{ color: "#1890ff" }} /> HDPE</>,
      dataIndex: "noOfTrashTrapsHDPE", key: "hdpe", width: 90,
      sorter: (a, b) => (a.noOfTrashTrapsHDPE || 0) - (b.noOfTrashTrapsHDPE || 0),
      render: (v) => v != null ? <Text strong style={{ color: "#13c2c2" }}>{v}</Text> : "—",
    },
    {
      title: <><BarChartOutlined style={{ color: "#722ed1" }} /> Waste Hauled</>,
      dataIndex: "estimatedVolumeWasteHauled", key: "waste", width: 130,
      sorter: (a, b) => (a.estimatedVolumeWasteHauled || 0) - (b.estimatedVolumeWasteHauled || 0),
      render: (v) => v != null ? <Text strong>{Number(v).toLocaleString()} kg</Text> : "—",
    },
    {
      title: <><SafetyCertificateOutlined style={{ color: "#faad14" }} /> Accessories</>,
      key: "accessories", width: 160,
      filters: [...new Set([
        ...(filters.statusOfWasteLifter || []).map((f) => f.value),
        ...(filters.statusOfPlasticBoat || []).map((f) => f.value),
      ])].sort().map((v) => ({ text: v, value: v })),
      onFilter: (v, r) => r.statusOfWasteLifter === v || r.statusOfPlasticBoat === v,
      render: (_, r) => (
        <Tooltip title={<div><div>Waste Lifter: {r.statusOfWasteLifter || "—"}</div><div>Plastic Boat: {r.statusOfPlasticBoat || "—"}</div></div>}>
          <div style={{ lineHeight: 1.5 }}>
            <div style={{ fontSize: 11 }}><ThunderboltOutlined style={{ color: "#faad14", marginRight: 4 }} />{getStatusTag(r.statusOfWasteLifter)}</div>
            <div style={{ fontSize: 11 }}><CompassOutlined style={{ color: "#13c2c2", marginRight: 4 }} />{getStatusTag(r.statusOfPlasticBoat)}</div>
          </div>
        </Tooltip>
      ),
    },
    {
      title: <><TeamOutlined style={{ color: "#722ed1" }} /> Personnel</>,
      key: "personnel", width: 170,
      render: (_, r) => (
        <Tooltip title={<div><div><UserOutlined /> Focal: {r.focalPerson || "—"}</div><div><SolutionOutlined /> ENMO: {r.enmoAssigned || "—"}</div></div>}>
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
      title: <><ClockCircleOutlined style={{ color: "#1890ff" }} /> Monitoring</>,
      dataIndex: "dateOfMonitoring", key: "monitoring", width: 120,
      render: (v) => v ? dayjs(v).format("MMM DD, YYYY") : "—",
    },
    {
      title: "Actions", key: "actions", width: 80, fixed: "right",
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="View Details"><Button type="text" size="small" icon={<EyeOutlined style={{ color: "#1890ff" }} />} onClick={() => setDetailModal(r)} /></Tooltip>
          <Tooltip title="Edit"><Button type="text" size="small" icon={<EditOutlined style={{ color: "#52c41a" }} />} onClick={() => openEdit(r)} /></Tooltip>
        </Space>
      ),
    },
  ];

  const handleExport = () => {
    const rows = filtered.map((r, i) => ({
      "#": i + 1,
      Province: r.province,
      Municipality: r.municipality,
      Barangay: r.barangay,
      MBA: r.manilaBayArea,
      "Date Installed": r.dateInstalled ? dayjs(r.dateInstalled).format("YYYY-MM-DD") : "",
      Status: r.statusOfTrashTraps,
      "HDPE Floaters": r.noOfTrashTrapsHDPE,
      "Waste Hauled (kg)": r.estimatedVolumeWasteHauled,
      "Waste Lifter": r.statusOfWasteLifter,
      "Plastic Boat": r.statusOfPlasticBoat,
      "Target Month": r.targetMonth,
      ENMO: r.enmoAssigned,
      "Focal Person": r.focalPerson,
    }));
    exportToExcel(rows, "Trash_Traps_Data");
  };

  return (
    <div>
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        @keyframes subtleBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        .trap-card { animation: fadeInUp 0.5s ease-out both; }
        .trap-tag-pulse { animation: pulse 2.5s ease-in-out infinite; }
        .trap-icon-bounce { display: inline-block; transition: transform 0.2s; cursor: default; }
        .trap-icon-bounce:hover { animation: subtleBounce 0.4s ease; }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <Title level={4} style={{ margin: 0 }}><ExperimentOutlined /> Trash Traps</Title>
        <Space wrap>
          <Input placeholder="Search..." prefix={<SearchOutlined />} value={searchText} onChange={(e) => setSearchText(e.target.value)} style={{ width: "100%", maxWidth: 200 }} allowClear />
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd} style={{ background: "#13c2c2", borderColor: "#13c2c2" }}>Add Record</Button>
          <Button icon={<DownloadOutlined />} onClick={handleExport}>Export</Button>
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
              <Select placeholder="Status" value={filterStatus} onChange={setFilterStatus} allowClear style={{ width: "100%", minWidth: 110, maxWidth: 160 }} size="small" options={trashTrapStatusOptions} suffixIcon={<SafetyCertificateOutlined />} />
              <Select placeholder="Target Month" value={filterMonth} onChange={setFilterMonth} allowClear style={{ width: "100%", minWidth: 110, maxWidth: 150 }} size="small" options={monthOptions} suffixIcon={<CalendarOutlined />} />
              {hasActiveFilters && <Tooltip title="Clear all filters"><Button size="small" type="link" danger icon={<ClearOutlined />} onClick={clearAllFilters}>Clear</Button></Tooltip>}
            </Space>
          </Col>
          <Col><Tag bordered={false} color={hasActiveFilters ? "blue" : "default"}>{filtered.length} / {records.length} records</Tag></Col>
        </Row>
      </Card>

      {/* Summary Dashboard Tiles */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={5}>
          <Card size="small" hoverable className="trap-card" style={{ borderRadius: 10, borderLeft: "3px solid #13c2c2", height: "100%" }}>
            <Statistic title="Total Traps" value={filtered.length} prefix={<ExperimentOutlined className="trap-icon-bounce" style={{ color: "#13c2c2" }} />} />
            <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
              <Tag color="blue" bordered={false}>MBA {mbaCount}</Tag>
              <Tag bordered={false}>Non-MBA {filtered.length - mbaCount}</Tag>
              <Tag color="purple" bordered={false}>{provinceCount} Provinces</Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="trap-card" style={{ borderRadius: 10, borderLeft: "3px solid #52c41a", height: "100%", animationDelay: "0.07s" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <Statistic title="Operational Rate" value={operationalRate.toFixed(1)} suffix="%" prefix={<CheckCircleOutlined className="trap-icon-bounce" style={{ color: "#52c41a" }} />} />
              <Progress type="circle" percent={Math.round(operationalRate)} size={48} strokeColor={{ "0%": "#52c41a", "100%": "#87d068" }} />
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
              <Tag color="green" bordered={false} className="trap-tag-pulse"><CheckCircleOutlined /> {operationalCount}</Tag>
              <Tag color="red" bordered={false} className="trap-tag-pulse"><CloseCircleOutlined /> {nonOperationalCount}</Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <Card size="small" hoverable className="trap-card" style={{ borderRadius: 10, borderLeft: "3px solid #1890ff", height: "100%", animationDelay: "0.14s" }}>
            <Statistic title="HDPE Floaters" value={totalHDPE} prefix={<ToolOutlined className="trap-icon-bounce" style={{ color: "#1890ff" }} />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <Card size="small" hoverable className="trap-card" style={{ borderRadius: 10, borderLeft: "3px solid #722ed1", height: "100%", animationDelay: "0.21s" }}>
            <Statistic title="Waste Hauled" value={totalWaste} prefix={<BarChartOutlined className="trap-icon-bounce" style={{ color: "#722ed1" }} />} suffix="kg" formatter={(v) => Number(v).toLocaleString()} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={5}>
          <Card size="small" hoverable className="trap-card" style={{ borderRadius: 10, borderLeft: "3px solid #faad14", height: "100%", animationDelay: "0.28s" }}>
            <Statistic title="Accessories Operational" value={wasteLifterOp + plasticBoatOp} prefix={<SafetyCertificateOutlined className="trap-icon-bounce" style={{ color: "#faad14" }} />} suffix={`/ ${(wasteLifterOp + wasteLifterNonOp + plasticBoatOp + plasticBoatNonOp) || filtered.length * 2}`} />
            <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
              <Tag color="green" bordered={false} className="trap-tag-pulse"><ThunderboltOutlined /> Lifter {wasteLifterOp}</Tag>
              <Tag color="red" bordered={false}><ThunderboltOutlined /> {wasteLifterNonOp}</Tag>
              <Tag color="green" bordered={false} className="trap-tag-pulse"><CompassOutlined /> Boat {plasticBoatOp}</Tag>
              <Tag color="red" bordered={false}><CompassOutlined /> {plasticBoatNonOp}</Tag>
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
        title={<Space><ExperimentOutlined />{detailModal?.municipality}, {detailModal?.province}</Space>}
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
                  <Col xs={24} sm={12}><Text type="secondary">Coordinates:</Text> <Text>{detailModal.latitude}, {detailModal.longitude}</Text></Col>
                </Row>
                <Divider plain orientation="left"><ExperimentOutlined /> Trap Details</Divider>
                <Row gutter={[16, 12]}>
                  <Col xs={24} sm={12}><Text type="secondary">Date Installed:</Text> <Text strong>{detailModal.dateInstalled ? dayjs(detailModal.dateInstalled).format("MMM DD, YYYY") : "—"}</Text></Col>
                  <Col xs={24} sm={12}><Text type="secondary">Status:</Text> {getStatusTag(detailModal.statusOfTrashTraps)}</Col>
                  <Col xs={24} sm={12}><Text type="secondary">HDPE Floaters:</Text> <Text strong>{detailModal.noOfTrashTrapsHDPE || "—"}</Text></Col>
                  <Col xs={24} sm={12}><Text type="secondary">Waste Hauled:</Text> <Text strong>{detailModal.estimatedVolumeWasteHauled ? `${Number(detailModal.estimatedVolumeWasteHauled).toLocaleString()} kg` : "—"}</Text></Col>
                  <Col xs={24} sm={12}><Text type="secondary">Last Hauling:</Text> <Text>{detailModal.dateOfLastHauling ? dayjs(detailModal.dateOfLastHauling).format("MMM DD, YYYY") : "—"}</Text></Col>
                </Row>
                <Divider plain orientation="left"><SafetyCertificateOutlined /> Accessories</Divider>
                <Row gutter={[16, 12]}>
                  <Col xs={24} sm={12}><Text type="secondary">Waste Lifter:</Text> {getStatusTag(detailModal.statusOfWasteLifter)}</Col>
                  <Col xs={24} sm={12}><Text type="secondary">Plastic Boat:</Text> {getStatusTag(detailModal.statusOfPlasticBoat)}</Col>
                </Row>
                <Divider plain orientation="left"><TeamOutlined /> Personnel</Divider>
                <Row gutter={[16, 12]}>
                  <Col xs={24} sm={8}><Text type="secondary"><UserOutlined /> Focal Person:</Text><br /><Text strong>{detailModal.focalPerson || "—"}</Text></Col>
                  <Col xs={24} sm={8}><Text type="secondary"><UserOutlined /> ESWM Staff:</Text><br /><Text strong>{detailModal.eswmStaff || "—"}</Text></Col>
                  <Col xs={24} sm={8}><Text type="secondary"><SolutionOutlined /> ENMO Assigned:</Text><br /><Text strong>{detailModal.enmoAssigned || "—"}</Text></Col>
                </Row>
              </>
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
                <Col xs={24} sm={8}><Text type="secondary">Days Prepared:</Text> <Text strong>{detailModal.totalDaysReportPrepared ?? "—"}</Text></Col>
                <Col xs={24} sm={8}><Text type="secondary">Days Staff Review:</Text> <Text strong>{detailModal.totalDaysReviewedStaff ?? "—"}</Text></Col>
                <Col xs={24} sm={8}><Text type="secondary">Days Focal Review:</Text> <Text strong>{detailModal.totalDaysReviewedFocal ?? "—"}</Text></Col>
              </Row>
            )},
            { key: "compliance", label: <><SafetyCertificateOutlined /> Compliance</>, children: (
              <Row gutter={[16, 12]}>
                <Col span={24}><Text type="secondary">Remarks:</Text><br /><Text>{detailModal.remarks || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Advise Letter:</Text> <Text>{detailModal.adviseLetterDateIssued || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Compliance:</Text> <Text>{detailModal.complianceToAdvise || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Signed Report:</Text> <Text>{detailModal.signedReport || "—"}</Text></Col>
              </Row>
            )},
          ]} />
        )}
      </Modal>

      {/* Add/Edit Modal */}
      <Modal
        title={editing ? "Edit Trash Trap" : "Add Trash Trap"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        width={900}
        style={{ maxWidth: "95vw" }}
        okText={editing ? "Update" : "Create"}
        okButtonProps={{ style: { background: "#13c2c2", borderColor: "#13c2c2" } }}
      >
        <Form form={form} layout="vertical" size="small">
          <Collapse defaultActiveKey={["location","details","personnel","monitoring","compliance"]} bordered={false} items={[
            { key: "location", label: <span style={{ color: "#1677ff" }}><EnvironmentOutlined /> Location</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={12}><Form.Item name="province" label="Province" rules={[{ required: true }]}><Select options={provinceOptions} placeholder="Select Province" /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="municipality" label="Municipality" rules={[{ required: true }]}><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="barangay" label="Barangay"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="manilaBayArea" label="Manila Bay Area"><Select options={mbaOptions} allowClear /></Form.Item></Col>
                <Col xs={12} sm={6}><Form.Item name="latitude" label="Latitude"><InputNumber style={{ width: "100%" }} step={0.000001} /></Form.Item></Col>
                <Col xs={12} sm={6}><Form.Item name="longitude" label="Longitude"><InputNumber style={{ width: "100%" }} step={0.000001} /></Form.Item></Col>
              </Row>
            )},
            { key: "details", label: <span style={{ color: "#fa8c16" }}><ExperimentOutlined /> Trap Details</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={12}><Form.Item name="dateInstalled" label="Date Installed"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="statusOfTrashTraps" label="Status"><Select options={trashTrapStatusOptions} allowClear placeholder="Select Status" /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="noOfTrashTrapsHDPE" label="HDPE Floaters"><InputNumber style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="estimatedVolumeWasteHauled" label="Waste Hauled (kg)"><InputNumber style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="dateOfLastHauling" label="Last Hauling"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="statusOfWasteLifter" label="Waste Lifter Status"><Select options={trashTrapStatusOptions} allowClear placeholder="Select Status" /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="statusOfPlasticBoat" label="Plastic Boat Status"><Select options={trashTrapStatusOptions} allowClear placeholder="Select Status" /></Form.Item></Col>
              </Row>
            )},
            { key: "personnel", label: <span style={{ color: "#52c41a" }}><TeamOutlined /> Personnel</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={8}><Form.Item name="enmoAssigned" label="ENMO Assigned"><Select options={enmoOptions} allowClear showSearch placeholder="Select ENMO" /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="eswmStaff" label="ESWM Staff"><Select options={eswmStaffOptions} allowClear showSearch placeholder="Select Staff" /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="focalPerson" label="Focal Person"><Select options={focalOptions} allowClear showSearch placeholder="Select Focal" /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="targetMonth" label="Target Month"><Select options={monthOptions} allowClear placeholder="Select" /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="iisNumber" label="IIS Number"><Input /></Form.Item></Col>
              </Row>
            )},
            { key: "monitoring", label: <span style={{ color: "#13c2c2" }}><CalendarOutlined /> Monitoring</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={8}><Form.Item name="dateOfMonitoring" label="Date of Monitoring"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateReportPrepared" label="Report Prepared"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateReportReviewedStaff" label="Reviewed (Staff)"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateReportReviewedFocal" label="Reviewed (Focal)"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateReportApproved" label="Report Approved"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
              </Row>
            )},
            { key: "compliance", label: <span style={{ color: "#eb2f96" }}><SafetyCertificateOutlined /> Compliance</span>, children: (
              <Row gutter={16}>
                <Col span={24}><Form.Item name="remarks" label="Remarks"><Input.TextArea rows={2} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="adviseLetterDateIssued" label="Advise Letter Date"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="complianceToAdvise" label="Compliance"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="signedReport" label="Signed Report"><Input /></Form.Item></Col>
              </Row>
            )},
          ]} />
        </Form>
      </Modal>
    </div>
  );
}
