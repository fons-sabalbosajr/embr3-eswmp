import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card, Table, Button, Modal, Form, Input, InputNumber, Select, Space, Tag,
  Divider, Row, Col, Typography, DatePicker, Tooltip, Collapse, Statistic,
} from "antd";
import {
  PlusOutlined, EditOutlined, DownloadOutlined, SearchOutlined, EyeOutlined,
  CheckCircleOutlined, CloseCircleOutlined, EnvironmentOutlined, FileTextOutlined,
  ReloadOutlined, TeamOutlined, CalendarOutlined, UserOutlined, SolutionOutlined,
  SafetyCertificateOutlined, FilterOutlined, ClearOutlined, AlertOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import secureStorage from "../../utils/secureStorage";
import { useDataRef } from "../../utils/dataRef";
import dayjs from "dayjs";

const { Title, Text } = Typography;
const CACHE_KEY = "residual-containment-cache";
const CACHE_TTL = 5 * 60 * 1000;

function buildFilters(records, key) {
  const vals = [...new Set(records.map((r) => r[key]).filter(Boolean))].sort();
  return vals.map((v) => ({ text: v, value: v }));
}
function networkDays(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const s = dayjs(startDate).startOf("day"); const e = dayjs(endDate).startOf("day");
  if (!s.isValid() || !e.isValid()) return null;
  let count = 0; let cur = s; const dir = e.isAfter(s) ? 1 : -1;
  while (dir > 0 ? !cur.isAfter(e) : !cur.isBefore(e)) { const dow = cur.day(); if (dow !== 0 && dow !== 6) count++; cur = cur.add(dir, "day"); }
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

export default function ResidualContainment() {
  const { getValues } = useDataRef();
  const provinceOptions = getValues("province").map((p) => ({ label: p, value: p }));
  const monthOptions = getValues("target-month").map((m) => ({ label: m.replace(/^\d+\./, ""), value: m }));
  const mbaOptions = getValues("manila-bay-area").map((v) => ({ label: v, value: v }));
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
        if (cached && Date.now() - cached.ts < CACHE_TTL) { setRecords(cached.data.map((r) => ({ ...r, ...computeFields(r) }))); setLoading(false); return; }
      }
      const { data } = await api.get("/residual-containment");
      const enriched = data.map((r) => ({ ...r, ...computeFields(r) }));
      setRecords(enriched);
      secureStorage.setJSON(CACHE_KEY, { data, ts: Date.now() });
    } catch { Swal.fire("Error", "Failed to load records", "error"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const openAdd = () => { setEditing(null); form.resetFields(); setModalOpen(true); };
  const openEdit = (record) => {
    setEditing(record);
    form.setFieldsValue({ ...record,
      dateOfMonitoring: record.dateOfMonitoring ? dayjs(record.dateOfMonitoring) : null,
      dateReportPrepared: record.dateReportPrepared ? dayjs(record.dateReportPrepared) : null,
      dateReportReviewedStaff: record.dateReportReviewedStaff ? dayjs(record.dateReportReviewedStaff) : null,
      dateReportReviewedFocal: record.dateReportReviewedFocal ? dayjs(record.dateReportReviewedFocal) : null,
      dateReportApproved: record.dateReportApproved ? dayjs(record.dateReportApproved) : null,
      dateOfHauling: record.dateOfHauling ? dayjs(record.dateOfHauling) : null,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const payload = { ...values,
        dateOfMonitoring: values.dateOfMonitoring?.toISOString(),
        dateReportPrepared: values.dateReportPrepared?.toISOString(),
        dateReportReviewedStaff: values.dateReportReviewedStaff?.toISOString(),
        dateReportReviewedFocal: values.dateReportReviewedFocal?.toISOString(),
        dateReportApproved: values.dateReportApproved?.toISOString(),
        dateOfHauling: values.dateOfHauling?.toISOString(),
      };
      Object.assign(payload, computeFields(payload));
      if (editing) {
        const { data } = await api.put(`/residual-containment/${editing._id}`, payload);
        setRecords((prev) => prev.map((r) => r._id === editing._id ? { ...data, ...computeFields(data) } : r));
        secureStorage.remove(CACHE_KEY);
        Swal.fire("Updated", "Record updated successfully", "success");
      } else {
        await api.post("/residual-containment", payload);
        secureStorage.remove(CACHE_KEY);
        Swal.fire("Created", "Record added successfully", "success");
        fetchRecords();
      }
    } catch (err) { if (err.response) Swal.fire("Error", err.response.data?.message || "Save failed", "error"); }
    setModalOpen(false);
  };

  const handleDelete = (record) => {
    Swal.fire({ title: "Delete this record?", text: `${record.municipality}, ${record.province}`, icon: "warning", showCancelButton: true, confirmButtonColor: "#ff4d4f", confirmButtonText: "Delete" })
      .then(async (result) => { if (result.isConfirmed) { await api.delete(`/residual-containment/${record._id}`); secureStorage.remove(CACHE_KEY); setRecords((prev) => prev.filter((r) => r._id !== record._id)); Swal.fire("Deleted", "Record deleted", "success"); } });
  };

  const hasActiveFilters = filterProvince || filterMBA || filterStatus || filterMonth || searchText;
  const clearAllFilters = () => { setFilterProvince(null); setFilterMBA(null); setFilterStatus(null); setFilterMonth(null); setSearchText(""); };

  const filtered = useMemo(() => {
    let data = records;
    if (searchText) { const s = searchText.toLowerCase(); data = data.filter((r) => [r.province, r.municipality, r.barangay, r.focalPerson, r.enmoAssigned, r.statusOfFacility].some((v) => v && v.toLowerCase().includes(s))); }
    if (filterProvince) data = data.filter((r) => r.province === filterProvince);
    if (filterMBA) data = data.filter((r) => r.manilaBayArea === filterMBA);
    if (filterStatus) data = data.filter((r) => r.statusOfFacility === filterStatus);
    if (filterMonth) data = data.filter((r) => r.targetMonth === filterMonth);
    return data;
  }, [records, searchText, filterProvince, filterMBA, filterStatus, filterMonth]);

  const filters = useMemo(() => ({
    province: buildFilters(records, "province"),
    manilaBayArea: buildFilters(records, "manilaBayArea"),
    statusOfFacility: buildFilters(records, "statusOfFacility"),
    focalPerson: buildFilters(records, "focalPerson"),
    targetMonth: buildFilters(records, "targetMonth"),
  }), [records]);

  const columns = [
    {
      title: <><EnvironmentOutlined style={{ color: "#1a3353" }} /> LGU</>, key: "lgu", width: 150, fixed: "left",
      filters: filters.province, onFilter: (v, r) => r.province === v,
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
    { title: "MBA", dataIndex: "manilaBayArea", key: "mba", width: 80,
      filters: filters.manilaBayArea, onFilter: (v, r) => r.manilaBayArea === v,
      render: (v) => v === "MBA" ? <Tag color="blue" bordered={false}>MBA</Tag> : <Tag color="default" bordered={false}>{v || "—"}</Tag>,
    },
    { title: "Status", dataIndex: "statusOfFacility", key: "status", width: 130,
      filters: filters.statusOfFacility, onFilter: (v, r) => r.statusOfFacility === v,
      render: (v) => getStatusTag(v),
    },
    {
      title: <><AlertOutlined style={{ color: "#fa541c" }} /> Facility</>, key: "facility", width: 160,
      render: (_, r) => (
        <div style={{ lineHeight: 1.3 }}>
          <Text style={{ fontSize: 11 }}>{r.facilityOrBin || "—"}</Text><br />
          <Text type="secondary" style={{ fontSize: 10 }}>Bins: {r.numberOfBinUsed ?? "—"} · Area: {r.totalFloorArea ?? "—"} sq.m</Text>
        </div>
      ),
    },
    {
      title: <><TeamOutlined style={{ color: "#722ed1" }} /> Personnel</>, key: "personnel", width: 180,
      render: (_, r) => (
        <Tooltip title={<div><div>Focal: {r.focalPerson || "—"}</div><div>Staff: {r.eswmStaff || "—"}</div><div>ENMO: {r.enmoAssigned || "—"}</div></div>}>
          <div style={{ lineHeight: 1.3 }}>
            <Text style={{ fontSize: 11 }}><UserOutlined style={{ color: "#722ed1", marginRight: 4 }} />{r.focalPerson || "—"}</Text><br />
            <Text type="secondary" style={{ fontSize: 10 }}><SolutionOutlined style={{ marginRight: 3 }} />{r.enmoAssigned || "—"}</Text>
          </div>
        </Tooltip>
      ),
    },
    { title: "Target Month", dataIndex: "targetMonth", key: "targetMonth", width: 110,
      filters: filters.targetMonth, onFilter: (v, r) => r.targetMonth === v,
      render: (v) => v ? <Tag bordered={false} color="cyan">{v.replace(/^\d+\./, "")}</Tag> : "—",
    },
    { title: "Brgys", dataIndex: "noOfBarangayServed", key: "brgys", width: 70,
      sorter: (a, b) => (a.noOfBarangayServed || 0) - (b.noOfBarangayServed || 0),
      render: (v) => v != null ? <Tag bordered={false}>{v}</Tag> : "—",
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

  const operationalCount = filtered.filter((r) => /operational/i.test(r.statusOfFacility) && !/non/i.test(r.statusOfFacility)).length;
  const nonOperationalCount = filtered.filter((r) => /non/i.test(r.statusOfFacility)).length;
  const mbaCount = filtered.filter((r) => r.manilaBayArea === "MBA").length;
  const provinceCount = new Set(filtered.map((r) => r.province).filter(Boolean)).size;
  const totalBrgys = filtered.reduce((s, r) => s + (r.noOfBarangayServed || 0), 0);

  return (
    <div>
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .rca-card { animation: fadeInUp 0.5s ease-out both; }
        .rca-icon-bounce { display: inline-block; transition: transform 0.2s; cursor: default; }
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <Title level={4} style={{ margin: 0 }}><AlertOutlined /> Residual Containment Area</Title>
        <Space wrap>
          <Input placeholder="Search..." prefix={<SearchOutlined />} value={searchText} onChange={(e) => setSearchText(e.target.value)} style={{ width: "100%", maxWidth: 200 }} allowClear />
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>Add Record</Button>
          <Button icon={<DownloadOutlined />} onClick={() => {
            exportToExcel(filtered.map((r) => ({
              Province: r.province, Municipality: r.municipality, Barangay: r.barangay,
              "Manila Bay Area": r.manilaBayArea, Status: r.statusOfFacility,
              "Facility/Bin": r.facilityOrBin, "No. Bins": r.numberOfBinUsed,
              "Floor Area": r.totalFloorArea, "Brgys Served": r.noOfBarangayServed,
              "ENMO": r.enmoAssigned, "ESWM Staff": r.eswmStaff, "Focal": r.focalPerson,
              "Target Month": r.targetMonth,
            })), "Residual_Containment");
          }}>Export</Button>
          <Tooltip title="Refresh data"><Button icon={<ReloadOutlined />} onClick={() => fetchRecords(true)} loading={loading} /></Tooltip>
        </Space>
      </div>

      <Card size="small" style={{ borderRadius: 10, marginBottom: 12 }} bodyStyle={{ padding: "10px 16px" }}>
        <Row gutter={[10, 10]} align="middle">
          <Col><FilterOutlined style={{ color: "#1890ff", marginRight: 6 }} /><Text type="secondary" style={{ fontSize: 12 }}>Filters:</Text></Col>
          <Col flex="auto">
            <Space wrap size={8}>
              <Select placeholder="Province" value={filterProvince} onChange={setFilterProvince} allowClear style={{ width: "100%", minWidth: 120, maxWidth: 160 }} size="small" options={provinceOptions} />
              <Select placeholder="MBA" value={filterMBA} onChange={setFilterMBA} allowClear style={{ width: "100%", minWidth: 100, maxWidth: 140 }} size="small" options={mbaOptions} />
              <Select placeholder="Status" value={filterStatus} onChange={setFilterStatus} allowClear style={{ width: "100%", minWidth: 120, maxWidth: 180 }} size="small" options={filters.statusOfFacility.map((f) => ({ label: f.text, value: f.value }))} />
              <Select placeholder="Target Month" value={filterMonth} onChange={setFilterMonth} allowClear style={{ width: "100%", minWidth: 110, maxWidth: 150 }} size="small" options={monthOptions} />
              {hasActiveFilters && <Tooltip title="Clear all filters"><Button size="small" type="link" danger icon={<ClearOutlined />} onClick={clearAllFilters}>Clear</Button></Tooltip>}
            </Space>
          </Col>
          <Col><Tag bordered={false} color={hasActiveFilters ? "blue" : "default"}>{filtered.length} / {records.length} records</Tag></Col>
        </Row>
      </Card>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="rca-card" style={{ borderRadius: 10, borderLeft: "3px solid #1a3353", height: "100%" }}>
            <Statistic title="Total RCAs" value={filtered.length} prefix={<AlertOutlined className="rca-icon-bounce" style={{ color: "#1a3353" }} />} />
            <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
              <Tag color="blue" bordered={false}>MBA {mbaCount}</Tag>
              <Tag color="purple" bordered={false}>{provinceCount} Provinces</Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="rca-card" style={{ borderRadius: 10, borderLeft: "3px solid #52c41a", height: "100%", animationDelay: "0.07s" }}>
            <Statistic title="Operational" value={operationalCount} prefix={<CheckCircleOutlined className="rca-icon-bounce" style={{ color: "#52c41a" }} />} />
            <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
              <Tag color="green" bordered={false}><CheckCircleOutlined /> {operationalCount}</Tag>
              <Tag color="red" bordered={false}><CloseCircleOutlined /> {nonOperationalCount}</Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="rca-card" style={{ borderRadius: 10, borderLeft: "3px solid #1890ff", height: "100%", animationDelay: "0.14s" }}>
            <Statistic title="Brgys Served" value={totalBrgys} prefix={<EnvironmentOutlined className="rca-icon-bounce" style={{ color: "#1890ff" }} />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="rca-card" style={{ borderRadius: 10, borderLeft: "3px solid #faad14", height: "100%", animationDelay: "0.21s" }}>
            <Statistic title="Monitored" value={filtered.filter((r) => r.dateOfMonitoring).length} suffix={`/ ${filtered.length}`} prefix={<CalendarOutlined className="rca-icon-bounce" style={{ color: "#faad14" }} />} />
          </Card>
        </Col>
      </Row>

      <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: 0 }}>
        <Table dataSource={filtered} columns={columns} rowKey="_id" size="small" loading={loading} scroll={{ x: 1100 }}
          pagination={{ defaultPageSize: 15, pageSizeOptions: ["10", "15", "25", "50", "100"], showSizeChanger: true, showTotal: (t, r) => `${r[0]}-${r[1]} of ${t}` }} />
      </Card>

      <Modal title={<Space><FileTextOutlined />{detailModal?.municipality}, {detailModal?.province}</Space>} open={!!detailModal} onCancel={() => setDetailModal(null)} footer={<Button onClick={() => setDetailModal(null)}>Close</Button>} width={800} style={{ maxWidth: "95vw" }}>
        {detailModal && (
          <Collapse defaultActiveKey={["general","facility","monitoring","compliance"]} bordered={false} items={[
            { key: "general", label: <span style={{ color: "#1677ff" }}><EnvironmentOutlined /> General Info</span>, children: (
              <Row gutter={[16, 12]}>
                <Col xs={24} sm={12}><Text type="secondary">Province:</Text> <Text strong>{detailModal.province}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Municipality:</Text> <Text strong>{detailModal.municipality}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Barangay:</Text> <Text>{detailModal.barangay || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">MBA:</Text> {detailModal.manilaBayArea === "MBA" ? <Tag color="blue" bordered={false}>MBA</Tag> : <Text>{detailModal.manilaBayArea || "—"}</Text>}</Col>
                <Col xs={24} sm={12}><Text type="secondary">District:</Text> <Text>{detailModal.congressionalDistrict || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Status:</Text> {getStatusTag(detailModal.statusOfFacility)}</Col>
              </Row>
            )},
            { key: "facility", label: <span style={{ color: "#fa8c16" }}><AlertOutlined /> Facility Details</span>, children: (
              <Row gutter={[16, 12]}>
                <Col xs={24} sm={12}><Text type="secondary">Facility/Bin:</Text> <Text>{detailModal.facilityOrBin || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">No. Bins Used:</Text> <Text>{detailModal.numberOfBinUsed ?? "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Floor Area (sq.m):</Text> <Text>{detailModal.totalFloorArea ?? "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Date Operationalized:</Text> <Text>{detailModal.dateOperationalized || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Waste Received:</Text> <Text>{detailModal.actualWasteReceived || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">RCA Capacity:</Text> <Text>{detailModal.rcaStorageCapacity || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Volume Residual Waste:</Text> <Text>{detailModal.totalVolumeResidualWaste ?? "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Hauling Date:</Text> <Text>{detailModal.dateOfHauling ? dayjs(detailModal.dateOfHauling).format("MMM D, YYYY") : "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Volume Hauled:</Text> <Text>{detailModal.volumeOfWasteHauled || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Hauler:</Text> <Text>{detailModal.hauler || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Final Disposal:</Text> <Text>{detailModal.finalDisposal || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Co-Processing:</Text> <Text>{detailModal.coProcessingFacility || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Brgys Served:</Text> <Text>{detailModal.noOfBarangayServed ?? "—"}</Text></Col>
              </Row>
            )},
            { key: "monitoring", label: <span style={{ color: "#13c2c2" }}><CalendarOutlined /> Monitoring</span>, children: (
              <Row gutter={[16, 12]}>
                <Col xs={24} sm={8}><Text type="secondary">Focal:</Text> <Text strong>{detailModal.focalPerson || "—"}</Text></Col>
                <Col xs={24} sm={8}><Text type="secondary">Staff:</Text> <Text strong>{detailModal.eswmStaff || "—"}</Text></Col>
                <Col xs={24} sm={8}><Text type="secondary">ENMO:</Text> <Text strong>{detailModal.enmoAssigned || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Monitoring Date:</Text> <Text>{detailModal.dateOfMonitoring ? dayjs(detailModal.dateOfMonitoring).format("MMM D, YYYY") : "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Tracking:</Text> <Text>{detailModal.trackingOfReports || "—"}</Text></Col>
              </Row>
            )},
            { key: "compliance", label: <span style={{ color: "#eb2f96" }}><SafetyCertificateOutlined /> Compliance</span>, children: (
              <Row gutter={[16, 12]}>
                <Col span={24}><Text type="secondary">Remarks (Not Operational):</Text><br /><Text>{detailModal.remarksIfNotOperational || "—"}</Text></Col>
                <Col span={24}><Text type="secondary">Remarks & Recommendation:</Text><br /><Text>{detailModal.remarksAndRecommendation || "—"}</Text></Col>
                <Col span={24}><Text type="secondary">Findings:</Text><br /><Text>{detailModal.findings || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Docket No. / NOV:</Text> <Text>{detailModal.docketNoNOV || "—"}</Text></Col>
                <Col xs={24} sm={12}><Text type="secondary">Violation:</Text> <Text>{detailModal.violation || "—"}</Text></Col>
                <Col span={24}><Text type="secondary">Commitments:</Text><br /><Text>{detailModal.commitments || "—"}</Text></Col>
              </Row>
            )},
          ]} />
        )}
      </Modal>

      <Modal title={editing ? "Edit RCA" : "Add RCA"} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={handleSave} width={900} style={{ maxWidth: "95vw" }} okText={editing ? "Update" : "Create"}>
        <Form form={form} layout="vertical" size="small">
          <Collapse defaultActiveKey={["location","facility","personnel","monitoring","compliance"]} bordered={false} items={[
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
            { key: "facility", label: <span style={{ color: "#fa8c16" }}><AlertOutlined /> Facility Details</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={12}><Form.Item name="statusOfFacility" label="Status"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="facilityOrBin" label="Facility/Bin"><Input /></Form.Item></Col>
                <Col xs={12} sm={6}><Form.Item name="numberOfBinUsed" label="No. Bins"><InputNumber style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={12} sm={6}><Form.Item name="totalFloorArea" label="Floor Area (sq.m)"><InputNumber style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="dateOperationalized" label="Date Operationalized"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="actualWasteReceived" label="Waste Received"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="rcaStorageCapacity" label="RCA Capacity"><Input /></Form.Item></Col>
                <Col xs={12} sm={6}><Form.Item name="totalVolumeResidualWaste" label="Volume Residual"><InputNumber style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateOfHauling" label="Date of Hauling"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="volumeOfWasteHauled" label="Volume Hauled"><Input /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="hauler" label="Hauler"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="finalDisposal" label="Final Disposal"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="coProcessingFacility" label="Co-Processing"><Input /></Form.Item></Col>
                <Col xs={12} sm={6}><Form.Item name="noOfBarangayServed" label="Brgys Served"><InputNumber style={{ width: "100%" }} /></Form.Item></Col>
              </Row>
            )},
            { key: "personnel", label: <span style={{ color: "#52c41a" }}><TeamOutlined /> Personnel</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={8}><Form.Item name="enmoAssigned" label="ENMO"><Select options={enmoOptions} allowClear showSearch /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="eswmStaff" label="ESWM Staff"><Select options={eswmStaffOptions} allowClear showSearch /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="focalPerson" label="Focal Person"><Select options={focalOptions} allowClear showSearch /></Form.Item></Col>
              </Row>
            )},
            { key: "monitoring", label: <span style={{ color: "#13c2c2" }}><CalendarOutlined /> Monitoring</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={8}><Form.Item name="targetMonth" label="Target Month"><Select options={monthOptions} allowClear /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="iisNumber" label="IIS Number"><Input /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateOfMonitoring" label="Monitoring Date"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateReportPrepared" label="Report Prepared"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateReportReviewedStaff" label="Reviewed (Staff)"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateReportReviewedFocal" label="Reviewed (Focal)"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateReportApproved" label="Report Approved"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={16}><Form.Item name="trackingOfReports" label="Tracking"><Input /></Form.Item></Col>
              </Row>
            )},
            { key: "compliance", label: <span style={{ color: "#eb2f96" }}><SafetyCertificateOutlined /> Compliance</span>, children: (
              <Row gutter={16}>
                <Col span={24}><Form.Item name="remarksIfNotOperational" label="Remarks (Not Operational)"><Input.TextArea rows={2} /></Form.Item></Col>
                <Col span={24}><Form.Item name="remarksAndRecommendation" label="Remarks & Recommendation"><Input.TextArea rows={2} /></Form.Item></Col>
                <Col span={24}><Form.Item name="findings" label="Findings"><Input.TextArea rows={2} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="docketNoNOV" label="Docket No. / NOV"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="violation" label="Violation"><Input /></Form.Item></Col>
                <Col span={24}><Form.Item name="commitments" label="Commitments"><Input.TextArea rows={2} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="signedReport" label="Signed Report URL"><Input /></Form.Item></Col>
              </Row>
            )},
          ]} />
        </Form>
      </Modal>
    </div>
  );
}
