import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card, Table, Button, Modal, Form, Input, InputNumber, Select, Space, Tag,
  Row, Col, Typography, DatePicker, Tooltip, Collapse, Statistic, Descriptions,
} from "antd";
import {
  PlusOutlined, EditOutlined, DownloadOutlined, SearchOutlined, EyeOutlined,
  CheckCircleOutlined, CloseCircleOutlined, EnvironmentOutlined, FileTextOutlined,
  ReloadOutlined, TeamOutlined, CalendarOutlined, UserOutlined, SolutionOutlined,
  SafetyCertificateOutlined, FilterOutlined, ClearOutlined, SwapOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import secureStorage from "../../utils/secureStorage";
import { useDataRef } from "../../utils/dataRef";
import dayjs from "dayjs";

const { Title, Text } = Typography;
const CACHE_KEY = "transfer-stations-cache";
const CACHE_TTL = 5 * 60 * 1000;

function buildFilters(records, key) {
  const vals = [...new Set(records.map((r) => r[key]).filter(Boolean))].sort();
  return vals.map((v) => ({ text: v, value: v }));
}
function networkDays(s, e) {
  if (!s || !e) return null;
  const sd = dayjs(s).startOf("day"); const ed = dayjs(e).startOf("day");
  if (!sd.isValid() || !ed.isValid()) return null;
  let count = 0; let cur = sd; const dir = ed.isAfter(sd) ? 1 : -1;
  while (dir > 0 ? !cur.isAfter(ed) : !cur.isBefore(ed)) { if (cur.day() !== 0 && cur.day() !== 6) count++; cur = cur.add(dir, "day"); }
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
  if (/operational/i.test(v) && !/non/i.test(v)) return <Tag color="green" bordered={false}><CheckCircleOutlined /> {v}</Tag>;
  if (/non/i.test(v)) return <Tag color="red" bordered={false}><CloseCircleOutlined /> {v}</Tag>;
  return <Tag bordered={false}>{v}</Tag>;
}

export default function TransferStations({canEdit = true, canDelete = true, isDark}) {
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
  const [detailYearRecords, setDetailYearRecords] = useState([]);
  const [detailYear, setDetailYear] = useState(null);
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
      const { data } = await api.get("/transfer-stations");
      const enriched = data.map((r) => ({ ...r, ...computeFields(r) }));
      setRecords(enriched);
      secureStorage.setJSON(CACHE_KEY, { data, ts: Date.now() });
    } catch { Swal.fire("Error", "Failed to load records", "error"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // Fetch cross-year history when viewing a record
  useEffect(() => {
    if (!detailModal) { setDetailYearRecords([]); setDetailYear(null); return; }
    const name = detailModal.municipality;
    api.get(`/transfer-stations/history/${encodeURIComponent(name)}`)
      .then(({ data }) => {
        const enriched = data.map((r) => ({ ...r, ...computeFields(r) }));
        setDetailYearRecords(enriched);
        setDetailYear(detailModal.dataYear || new Date().getFullYear());
      })
      .catch(() => { setDetailYearRecords([]); setDetailYear(detailModal.dataYear || new Date().getFullYear()); });
  }, [detailModal]);

  const detailViewRecord = useMemo(() => {
    if (detailYearRecords.length === 0) return detailModal;
    return detailYearRecords.find((r) => (r.dataYear || new Date().getFullYear()) === detailYear) || detailModal;
  }, [detailModal, detailYearRecords, detailYear]);


  const openAdd = (prefill) => { setEditing(null); form.resetFields(); if (prefill) form.setFieldsValue(prefill); setModalOpen(true); };
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
        const { data } = await api.put(`/transfer-stations/${editing._id}`, payload);
        setRecords((prev) => prev.map((r) => r._id === editing._id ? { ...data, ...computeFields(data) } : r));
        secureStorage.remove(CACHE_KEY);
        Swal.fire("Updated", "Record updated successfully", "success");
      } else {
        await api.post("/transfer-stations", payload);
        secureStorage.remove(CACHE_KEY);
        Swal.fire("Created", "Record added successfully", "success");
        fetchRecords();
      }
    } catch (err) { if (err.response) Swal.fire("Error", err.response.data?.message || "Save failed", "error"); }
    setModalOpen(false);
  };

  const handleDelete = (record) => {
    Swal.fire({ title: "Delete this record?", text: `${record.municipality}, ${record.province}`, icon: "warning", showCancelButton: true, confirmButtonColor: "#ff4d4f", confirmButtonText: "Delete" })
      .then(async (result) => { if (result.isConfirmed) { await api.delete(`/transfer-stations/${record._id}`); secureStorage.remove(CACHE_KEY); setRecords((prev) => prev.filter((r) => r._id !== record._id)); Swal.fire("Deleted", "Record deleted", "success"); } });
  };

  const hasActiveFilters = filterProvince || filterMBA || filterStatus || filterMonth || searchText;
  const clearAllFilters = () => { setFilterProvince(null); setFilterMBA(null); setFilterStatus(null); setFilterMonth(null); setSearchText(""); };

  const filtered = useMemo(() => {
    let data = records;
    if (searchText) { const s = searchText.toLowerCase(); data = data.filter((r) => [r.province, r.municipality, r.focalPerson, r.enmoAssigned, r.statusOfFacility].some((v) => v && v.toLowerCase().includes(s))); }
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
    targetMonth: buildFilters(records, "targetMonth"),
  }), [records]);

  const columns = [
    {
      title: <span><EnvironmentOutlined style={{ color: isDark ? "#7eb8da" : "#1a3353" }} /> LGU</span>, key: "lgu", width: 150, fixed: "left",
      filters: filters.province, onFilter: (v, r) => r.province === v,
      sorter: (a, b) => (a.municipality || "").localeCompare(b.municipality || ""),
      render: (_, r) => (
        <Tooltip title={`${r.province} — ${r.municipality}`}>
          <div style={{ lineHeight: 1.3 }}>
            <Text strong style={{ fontSize: 12 }}>{r.municipality}</Text><br />
            <Text type="secondary" style={{ fontSize: 11 }}>{r.province}</Text>
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
      title: <span><SwapOutlined style={{ color: "#2f54eb" }} /> Facility</span>, key: "facility", width: 180,
      render: (_, r) => (
        <div style={{ lineHeight: 1.3 }}>
          <Text style={{ fontSize: 11 }}>{r.facilityOrBin || "—"}</Text><br />
          <Text type="secondary" style={{ fontSize: 10 }}>Bins: {r.numberOfBinUsed ?? "—"} · {r.typeOfOwnership || "—"}</Text><br />
          <Text type="secondary" style={{ fontSize: 10 }}>Waste: {r.actualWasteReceived ?? "—"} · Dist: {r.distanceToSLF ?? "—"}</Text>
        </div>
      ),
    },
    {
      title: <span><TeamOutlined style={{ color: "#722ed1" }} /> Personnel</span>, key: "personnel", width: 160,
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
    {
      title: "Actions", key: "actions", width: 80, fixed: "right",
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title="View Details"><Button type="text" size="small" icon={<EyeOutlined style={{ color: "#1890ff" }} />} onClick={() => setDetailModal(record)} /></Tooltip>
          {canEdit && <Tooltip title="Edit"><Button type="text" size="small" icon={<EditOutlined style={{ color: "#52c41a" }} />} onClick={() => openEdit(record)} /></Tooltip>}
          {canEdit && <Tooltip title="Add Record"><Button type="text" size="small" icon={<PlusOutlined style={{ color: "#13c2c2" }} />} onClick={() => openAdd({ municipality: record.municipality, province: record.province, barangay: record.barangay, manilaBayArea: record.manilaBayArea })} /></Tooltip>}
        </Space>
      ),
    },
  ];

  const mbaCount = filtered.filter((r) => r.manilaBayArea === "MBA").length;
  const provinceCount = new Set(filtered.map((r) => r.province).filter(Boolean)).size;
  const operationalCount = filtered.filter((r) => /operational/i.test(r.statusOfFacility) && !/non/i.test(r.statusOfFacility)).length;

  return (
    <div>
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .ts-card { animation: fadeInUp 0.5s ease-out both; }
        .ts-icon-bounce { display: inline-block; transition: transform 0.2s; cursor: default; }
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <Title level={4} style={{ margin: 0 }}><SwapOutlined /> Transfer Stations</Title>
        <Space wrap>
          <Input placeholder="Search..." prefix={<SearchOutlined />} value={searchText} onChange={(e) => setSearchText(e.target.value)} style={{ width: "100%", maxWidth: 200 }} allowClear />
          {canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>Add Record</Button>}
          <Button icon={<DownloadOutlined />} onClick={() => {
            exportToExcel(filtered.map((r) => ({
              Province: r.province, Municipality: r.municipality, "MBA": r.manilaBayArea,
              "Status": r.statusOfFacility, "Facility/Bin": r.facilityOrBin, "Bins Used": r.numberOfBinUsed,
              "Ownership": r.typeOfOwnership, "Waste Received": r.actualWasteReceived, "Distance to SLF": r.distanceToSLF,
              "ENMO": r.enmoAssigned, "Staff": r.eswmStaff, "Focal": r.focalPerson, "Target Month": r.targetMonth,
            })), "TransferStations");
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
          <Card size="small" hoverable className="ts-card" style={{ borderRadius: 10, borderLeft: isDark ? "3px solid #4a7fb5" : "3px solid #1a3353", height: "100%" }}>
            <Statistic title="Total Stations" value={filtered.length} prefix={<SwapOutlined className="ts-icon-bounce" style={{ color: isDark ? "#7eb8da" : "#1a3353" }} />} />
            <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
              <Tag color="blue" bordered={false}>MBA {mbaCount}</Tag>
              <Tag color="purple" bordered={false}>{provinceCount} Provinces</Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="ts-card" style={{ borderRadius: 10, borderLeft: "3px solid #52c41a", height: "100%", animationDelay: "0.07s" }}>
            <Statistic title="Operational" value={operationalCount} suffix={`/ ${filtered.length}`} prefix={<CheckCircleOutlined className="ts-icon-bounce" style={{ color: "#52c41a" }} />} />
            <div style={{ marginTop: 8 }}>
              <Tag color="red" bordered={false}>Non-Op: {filtered.length - operationalCount}</Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="ts-card" style={{ borderRadius: 10, borderLeft: "3px solid #1890ff", height: "100%", animationDelay: "0.14s" }}>
            <Statistic title="Avg Distance to SLF" value={(() => { const vals = filtered.map((r) => parseFloat(r.distanceToSLF)).filter((n) => !isNaN(n)); return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : "—"; })()} suffix="km" prefix={<EnvironmentOutlined className="ts-icon-bounce" style={{ color: "#1890ff" }} />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="ts-card" style={{ borderRadius: 10, borderLeft: "3px solid #faad14", height: "100%", animationDelay: "0.21s" }}>
            <Statistic title="Monitored" value={filtered.filter((r) => r.dateOfMonitoring).length} suffix={`/ ${filtered.length}`} prefix={<CalendarOutlined className="ts-icon-bounce" style={{ color: "#faad14" }} />} />
          </Card>
        </Col>
      </Row>

      <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: 0 }}>
        <Table dataSource={filtered} columns={columns} rowKey="_id" size="small" loading={loading} scroll={{ x: 1000 }}
          pagination={{ defaultPageSize: 15, pageSizeOptions: ["10", "15", "25", "50", "100"], showSizeChanger: true, showTotal: (t, r) => `${r[0]}-${r[1]} of ${t}` }} />
      </Card>

      <Modal title={<Space><FileTextOutlined />{detailModal?.municipality}, {detailModal?.province}{detailYearRecords.length >= 1 && <Tag color="blue" bordered={false} style={{ marginLeft: 8 }}>{detailYearRecords.length} year records</Tag>}</Space>} open={!!detailModal} onCancel={() => setDetailModal(null)} footer={<Button onClick={() => setDetailModal(null)}>Close</Button>} width={800} style={{ maxWidth: "95vw" }}>
        {detailModal && (
          <>
            {detailYearRecords.length >= 1 && (
              <div style={{ marginBottom: 12 }}>
                <Space size={8}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Data Year:</Text>
                  {detailYearRecords.map((r) => r.dataYear || new Date().getFullYear()).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b - a).map((yr) => (
                    <Button key={yr} size="small" type={detailYear === yr ? "primary" : "default"} onClick={() => setDetailYear(yr)}>{yr}</Button>
                  ))}
                </Space>
              </div>
            )}
          <Collapse defaultActiveKey={["general","facility","monitoring","monitoring2","compliance"]} bordered={false} items={[
            { key: "general", label: <span style={{ color: "#1677ff" }}><EnvironmentOutlined /> General Info</span>, children: (
              <Descriptions column={2} size="small" bordered>
                <Descriptions.Item label="Province">{detailViewRecord.province}</Descriptions.Item>
                <Descriptions.Item label="Municipality">{detailViewRecord.municipality}</Descriptions.Item>
                <Descriptions.Item label="Barangay">{detailViewRecord.barangay || "—"}</Descriptions.Item>
                <Descriptions.Item label="MBA">{detailViewRecord.manilaBayArea === "MBA" ? <Tag color="blue" bordered={false}>MBA</Tag> : (detailViewRecord.manilaBayArea || "—")}</Descriptions.Item>
              </Descriptions>
            )},
            { key: "facility", label: <span style={{ color: "#fa8c16" }}><SwapOutlined /> Facility Details</span>, children: (
              <Descriptions column={2} size="small" bordered>
                <Descriptions.Item label="Status">{getStatusTag(detailViewRecord.statusOfFacility)}</Descriptions.Item>
                <Descriptions.Item label="Facility/Bin">{detailViewRecord.facilityOrBin || "—"}</Descriptions.Item>
                <Descriptions.Item label="Bins Used">{detailViewRecord.numberOfBinUsed ?? "—"}</Descriptions.Item>
                <Descriptions.Item label="Ownership">{detailViewRecord.typeOfOwnership || "—"}</Descriptions.Item>
                <Descriptions.Item label="Waste Received">{detailViewRecord.actualWasteReceived ?? "—"}</Descriptions.Item>
                <Descriptions.Item label="Distance to SLF">{detailViewRecord.distanceToSLF ?? "—"}</Descriptions.Item>
                <Descriptions.Item label="Hauling Date">{detailViewRecord.dateOfHauling ? dayjs(detailViewRecord.dateOfHauling).format("MMM D, YYYY") : "—"}</Descriptions.Item>
                <Descriptions.Item label="Disposal Facility">{detailViewRecord.disposalFacility || "—"}</Descriptions.Item>
              </Descriptions>
            )},
            { key: "monitoring", label: <span style={{ color: "#13c2c2" }}><CalendarOutlined /> Monitoring</span>, children: (
              <Descriptions column={3} size="small" bordered>
                <Descriptions.Item label="Focal">{detailViewRecord.focalPerson || "—"}</Descriptions.Item>
                <Descriptions.Item label="Staff">{detailViewRecord.eswmStaff || "—"}</Descriptions.Item>
                <Descriptions.Item label="ENMO">{detailViewRecord.enmoAssigned || "—"}</Descriptions.Item>
              </Descriptions>
            )},
            { key: "monitoring2", label: <span style={{ color: "#13c2c2" }}><CalendarOutlined /> Schedule</span>, children: (
              <Descriptions column={2} size="small" bordered>
                <Descriptions.Item label="Target Month">{detailViewRecord.targetMonth || "—"}</Descriptions.Item>
                <Descriptions.Item label="Monitoring Date">{detailViewRecord.dateOfMonitoring ? dayjs(detailViewRecord.dateOfMonitoring).format("MMM D, YYYY") : "—"}</Descriptions.Item>
              </Descriptions>
            )},
            { key: "compliance", label: <span style={{ color: "#eb2f96" }}><SafetyCertificateOutlined /> Compliance</span>, children: (
              <Descriptions column={2} size="small" bordered>
                <Descriptions.Item label="Remarks" span={2}>{detailViewRecord.remarks || "—"}</Descriptions.Item>
                <Descriptions.Item label="Advise Letter">{detailViewRecord.adviseLetterIssued || "—"}</Descriptions.Item>
                <Descriptions.Item label="Compliance to Advise">{detailViewRecord.complianceToAdvise || "—"}</Descriptions.Item>
              </Descriptions>
            )},
          ]} />
          </>
        )}
      </Modal>

      <Modal title={editing ? "Edit Transfer Station" : "Add Transfer Station"} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={handleSave} width={900} style={{ maxWidth: "95vw" }} okText={editing ? "Update" : "Create"}>
        <Form form={form} layout="vertical" size="small">
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={8}><Form.Item name="dataYear" label="Data Year" rules={[{ required: true }]}><Select options={Array.from({length:7},(_,i)=>{ const y=new Date().getFullYear()-i; return {label:y,value:y}; })} placeholder="Select Year" /></Form.Item></Col>
          </Row>
          <Collapse defaultActiveKey={["location","facility","personnel","monitoring","compliance"]} bordered={false} items={[
            { key: "location", label: <span style={{ color: "#1677ff" }}><EnvironmentOutlined /> Location</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={12}><Form.Item name="province" label="Province" rules={[{ required: true }]}><Select options={provinceOptions} placeholder="Select Province" /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="municipality" label="Municipality" rules={[{ required: true }]}><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="barangay" label="Barangay"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="manilaBayArea" label="Manila Bay Area"><Select options={mbaOptions} allowClear /></Form.Item></Col>
                <Col xs={12} sm={6}><Form.Item name="latitude" label="Latitude"><InputNumber style={{ width: "100%" }} step={0.0001} precision={4} /></Form.Item></Col>
                <Col xs={12} sm={6}><Form.Item name="longitude" label="Longitude"><InputNumber style={{ width: "100%" }} step={0.0001} precision={4} /></Form.Item></Col>
              </Row>
            )},
            { key: "facility", label: <span style={{ color: "#fa8c16" }}><SwapOutlined /> Facility Details</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={12}><Form.Item name="statusOfFacility" label="Status"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="facilityOrBin" label="Facility/Bin"><Input /></Form.Item></Col>
                <Col xs={12} sm={8}><Form.Item name="numberOfBinUsed" label="Bins Used"><InputNumber style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="typeOfOwnership" label="Ownership"><Input /></Form.Item></Col>
                <Col xs={12} sm={8}><Form.Item name="actualWasteReceived" label="Waste Received"><Input /></Form.Item></Col>
                <Col xs={12} sm={8}><Form.Item name="distanceToSLF" label="Distance to SLF"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="dateOfHauling" label="Hauling Date"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="disposalFacility" label="Disposal Facility"><Input /></Form.Item></Col>
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
                <Col span={24}><Form.Item name="remarks" label="Remarks"><Input.TextArea rows={2} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="adviseLetterIssued" label="Advise Letter"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="complianceToAdvise" label="Compliance to Advise"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="signedDocument" label="Signed Document URL"><Input /></Form.Item></Col>
              </Row>
            )},
          ]} />
        </Form>
      </Modal>
    </div>
  );
}
