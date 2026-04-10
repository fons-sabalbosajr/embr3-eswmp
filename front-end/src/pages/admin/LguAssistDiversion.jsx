import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card, Table, Button, Modal, Form, Input, InputNumber, Select, Space, Tag,
  Row, Col, Typography, DatePicker, Tooltip, Collapse, Statistic, Descriptions,
} from "antd";
import {
  PlusOutlined, EditOutlined, DownloadOutlined, SearchOutlined, EyeOutlined,
  CheckCircleOutlined, CloseCircleOutlined, EnvironmentOutlined, FileTextOutlined,
  ReloadOutlined, TeamOutlined, CalendarOutlined, UserOutlined, SolutionOutlined,
  SafetyCertificateOutlined, FilterOutlined, ClearOutlined, ReconciliationOutlined,
  PieChartOutlined, RiseOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import secureStorage from "../../utils/secureStorage";
import { useDataRef } from "../../utils/dataRef";
import dayjs from "dayjs";

const { Title, Text } = Typography;
const CACHE_KEY = "lgu-assist-diversion-cache";
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
  if (/compliant|completed|accomplished/i.test(v) && !/non/i.test(v)) return <Tag color="green" bordered={false}><CheckCircleOutlined /> {v}</Tag>;
  if (/non|pending|incomplete/i.test(v)) return <Tag color="red" bordered={false}><CloseCircleOutlined /> {v}</Tag>;
  return <Tag bordered={false}>{v}</Tag>;
}

export default function LguAssistDiversion() {
  const { getValues } = useDataRef();
  const provinceOptions = getValues("province").map((p) => ({ label: p, value: p }));
  const monthOptions = getValues("target-month").map((m) => ({ label: m.replace(/^\d+\./, ""), value: m }));
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
      const { data } = await api.get("/lgu-assist-diversion");
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
    const name = detailModal.lgu;
    api.get(`/lgu-assist-diversion/history/${encodeURIComponent(name)}`)
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
      };
      Object.assign(payload, computeFields(payload));
      if (editing) {
        const { data } = await api.put(`/lgu-assist-diversion/${editing._id}`, payload);
        setRecords((prev) => prev.map((r) => r._id === editing._id ? { ...data, ...computeFields(data) } : r));
        secureStorage.remove(CACHE_KEY);
        Swal.fire("Updated", "Record updated successfully", "success");
      } else {
        await api.post("/lgu-assist-diversion", payload);
        secureStorage.remove(CACHE_KEY);
        Swal.fire("Created", "Record added successfully", "success");
        fetchRecords();
      }
    } catch (err) { if (err.response) Swal.fire("Error", err.response.data?.message || "Save failed", "error"); }
    setModalOpen(false);
  };

  const handleDelete = (record) => {
    Swal.fire({ title: "Delete this record?", text: `${record.lgu}, ${record.province}`, icon: "warning", showCancelButton: true, confirmButtonColor: "#ff4d4f", confirmButtonText: "Delete" })
      .then(async (result) => { if (result.isConfirmed) { await api.delete(`/lgu-assist-diversion/${record._id}`); secureStorage.remove(CACHE_KEY); setRecords((prev) => prev.filter((r) => r._id !== record._id)); Swal.fire("Deleted", "Record deleted", "success"); } });
  };

  const hasActiveFilters = filterProvince || filterStatus || filterMonth || searchText;
  const clearAllFilters = () => { setFilterProvince(null); setFilterStatus(null); setFilterMonth(null); setSearchText(""); };

  const filtered = useMemo(() => {
    let data = records;
    if (searchText) { const s = searchText.toLowerCase(); data = data.filter((r) => [r.province, r.lgu, r.focalPerson, r.enmoAssigned, r.statusAccomplishment].some((v) => v && v.toLowerCase().includes(s))); }
    if (filterProvince) data = data.filter((r) => r.province === filterProvince);
    if (filterStatus) data = data.filter((r) => r.statusAccomplishment === filterStatus);
    if (filterMonth) data = data.filter((r) => r.targetMonth === filterMonth);
    return data;
  }, [records, searchText, filterProvince, filterStatus, filterMonth]);

  const filters = useMemo(() => ({
    province: buildFilters(records, "province"),
    statusAccomplishment: buildFilters(records, "statusAccomplishment"),
    targetMonth: buildFilters(records, "targetMonth"),
  }), [records]);

  const columns = [
    {
      title: <><EnvironmentOutlined style={{ color: "#1a3353" }} /> LGU</>, key: "lgu", width: 180, fixed: "left",
      filters: filters.province, onFilter: (v, r) => r.province === v,
      sorter: (a, b) => (a.lgu || "").localeCompare(b.lgu || ""),
      render: (_, r) => (
        <Tooltip title={`${r.province} — ${r.lgu}`}>
          <div style={{ lineHeight: 1.3 }}>
            <Text strong style={{ fontSize: 12 }}>{r.lgu}</Text><br />
            <Text type="secondary" style={{ fontSize: 11 }}>{r.province}</Text>
          </div>
        </Tooltip>
      ),
    },
    { title: "Status", dataIndex: "statusAccomplishment", key: "status", width: 140,
      filters: filters.statusAccomplishment, onFilter: (v, r) => r.statusAccomplishment === v,
      render: (v) => getStatusTag(v),
    },
    {
      title: <><PieChartOutlined style={{ color: "#2f54eb" }} /> Waste Diversion</>, key: "waste", width: 200,
      sorter: (a, b) => (a.percentageWasteDiversion || 0) - (b.percentageWasteDiversion || 0),
      render: (_, r) => (
        <div style={{ lineHeight: 1.3 }}>
          <Text style={{ fontSize: 11 }}>Generated: <Text strong>{r.totalWasteGeneration != null ? r.totalWasteGeneration.toLocaleString() : "—"}</Text></Text><br />
          <Text style={{ fontSize: 11 }}>Diverted: <Text strong style={{ color: "#52c41a" }}>{r.totalWasteDiverted != null ? r.totalWasteDiverted.toLocaleString() : "—"}</Text></Text><br />
          <Text style={{ fontSize: 11 }}>Rate: <Tag bordered={false} color={r.percentageWasteDiversion >= 25 ? "green" : r.percentageWasteDiversion >= 10 ? "orange" : "red"}>{r.percentageWasteDiversion != null ? `${r.percentageWasteDiversion.toFixed(1)}%` : "—"}</Tag></Text>
        </div>
      ),
    },
    {
      title: <><TeamOutlined style={{ color: "#722ed1" }} /> Personnel</>, key: "personnel", width: 160,
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
          <Tooltip title="Edit"><Button type="text" size="small" icon={<EditOutlined style={{ color: "#52c41a" }} />} onClick={() => openEdit(record)} /></Tooltip>
          <Tooltip title="Add Record"><Button type="text" size="small" icon={<PlusOutlined style={{ color: "#13c2c2" }} />} onClick={() => openAdd({ lgu: record.lgu, province: record.province })} /></Tooltip>
        </Space>
      ),
    },
  ];

  const provinceCount = new Set(filtered.map((r) => r.province).filter(Boolean)).size;
  const wasteVals = filtered.filter((r) => r.totalWasteGeneration != null);
  const totalWasteGen = wasteVals.reduce((s, r) => s + (r.totalWasteGeneration || 0), 0);
  const totalDiverted = wasteVals.reduce((s, r) => s + (r.totalWasteDiverted || 0), 0);
  const avgDiversion = filtered.filter((r) => r.percentageWasteDiversion != null);
  const avgDiversionRate = avgDiversion.length > 0 ? (avgDiversion.reduce((s, r) => s + r.percentageWasteDiversion, 0) / avgDiversion.length).toFixed(1) : "—";

  return (
    <div>
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .lad-card { animation: fadeInUp 0.5s ease-out both; }
        .lad-icon-bounce { display: inline-block; transition: transform 0.2s; cursor: default; }
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <Title level={4} style={{ margin: 0 }}><ReconciliationOutlined /> LGU Assistance & Waste Diversion</Title>
        <Space wrap>
          <Input placeholder="Search..." prefix={<SearchOutlined />} value={searchText} onChange={(e) => setSearchText(e.target.value)} style={{ width: "100%", maxWidth: 200 }} allowClear />
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>Add Record</Button>
          <Button icon={<DownloadOutlined />} onClick={() => {
            exportToExcel(filtered.map((r) => ({
              Province: r.province, LGU: r.lgu, "Waste Generated": r.totalWasteGeneration,
              "Waste Diverted": r.totalWasteDiverted, "Diversion %": r.percentageWasteDiversion,
              "Status": r.statusAccomplishment, "ENMO": r.enmoAssigned, "Staff": r.eswmStaff,
              "Focal": r.focalPerson, "Target Month": r.targetMonth,
            })), "LGU_Diversion");
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
              <Select placeholder="Status" value={filterStatus} onChange={setFilterStatus} allowClear style={{ width: "100%", minWidth: 120, maxWidth: 180 }} size="small" options={filters.statusAccomplishment.map((f) => ({ label: f.text, value: f.value }))} />
              <Select placeholder="Target Month" value={filterMonth} onChange={setFilterMonth} allowClear style={{ width: "100%", minWidth: 110, maxWidth: 150 }} size="small" options={monthOptions} />
              {hasActiveFilters && <Tooltip title="Clear all filters"><Button size="small" type="link" danger icon={<ClearOutlined />} onClick={clearAllFilters}>Clear</Button></Tooltip>}
            </Space>
          </Col>
          <Col><Tag bordered={false} color={hasActiveFilters ? "blue" : "default"}>{filtered.length} / {records.length} records</Tag></Col>
        </Row>
      </Card>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="lad-card" style={{ borderRadius: 10, borderLeft: "3px solid #1a3353", height: "100%" }}>
            <Statistic title="Total LGUs" value={filtered.length} prefix={<ReconciliationOutlined className="lad-icon-bounce" style={{ color: "#1a3353" }} />} />
            <div style={{ marginTop: 8 }}>
              <Tag color="purple" bordered={false}>{provinceCount} Provinces</Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="lad-card" style={{ borderRadius: 10, borderLeft: "3px solid #52c41a", height: "100%", animationDelay: "0.07s" }}>
            <Statistic title="Avg Diversion Rate" value={avgDiversionRate} suffix="%" prefix={<RiseOutlined className="lad-icon-bounce" style={{ color: "#52c41a" }} />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="lad-card" style={{ borderRadius: 10, borderLeft: "3px solid #1890ff", height: "100%", animationDelay: "0.14s" }}>
            <Statistic title="Total Waste Generated" value={totalWasteGen.toLocaleString()} prefix={<PieChartOutlined className="lad-icon-bounce" style={{ color: "#1890ff" }} />} />
            <div style={{ marginTop: 8 }}>
              <Tag color="green" bordered={false}>Diverted: {totalDiverted.toLocaleString()}</Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="lad-card" style={{ borderRadius: 10, borderLeft: "3px solid #faad14", height: "100%", animationDelay: "0.21s" }}>
            <Statistic title="Monitored" value={filtered.filter((r) => r.dateOfMonitoring).length} suffix={`/ ${filtered.length}`} prefix={<CalendarOutlined className="lad-icon-bounce" style={{ color: "#faad14" }} />} />
          </Card>
        </Col>
      </Row>

      <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: 0 }}>
        <Table dataSource={filtered} columns={columns} rowKey="_id" size="small" loading={loading} scroll={{ x: 900 }}
          pagination={{ defaultPageSize: 15, pageSizeOptions: ["10", "15", "25", "50", "100"], showSizeChanger: true, showTotal: (t, r) => `${r[0]}-${r[1]} of ${t}` }} />
      </Card>

      <Modal title={<Space><FileTextOutlined />{detailModal?.lgu}, {detailModal?.province}{detailYearRecords.length >= 1 && <Tag color="blue" bordered={false} style={{ marginLeft: 8 }}>{detailYearRecords.length} year records</Tag>}</Space>} open={!!detailModal} onCancel={() => setDetailModal(null)} footer={<Button onClick={() => setDetailModal(null)}>Close</Button>} width={700} style={{ maxWidth: "95vw" }}>
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
          <Collapse defaultActiveKey={["general","waste","monitoring","monitoring2","compliance"]} bordered={false} items={[
            { key: "general", label: <span style={{ color: "#1677ff" }}><EnvironmentOutlined /> General Info</span>, children: (
              <Descriptions column={2} size="small" bordered>
                <Descriptions.Item label="Province">{detailViewRecord.province}</Descriptions.Item>
                <Descriptions.Item label="LGU">{detailViewRecord.lgu}</Descriptions.Item>
                <Descriptions.Item label="Status">{getStatusTag(detailViewRecord.statusAccomplishment)}</Descriptions.Item>
              </Descriptions>
            )},
            { key: "waste", label: <span style={{ color: "#fa8c16" }}><PieChartOutlined /> Waste Data</span>, children: (
              <Descriptions column={3} size="small" bordered>
                <Descriptions.Item label="Waste Generated">{detailViewRecord.totalWasteGeneration?.toLocaleString() ?? "—"}</Descriptions.Item>
                <Descriptions.Item label="Waste Diverted"><Text strong style={{ color: "#52c41a" }}>{detailViewRecord.totalWasteDiverted?.toLocaleString() ?? "—"}</Text></Descriptions.Item>
                <Descriptions.Item label="Diversion Rate"><Tag bordered={false} color={detailViewRecord.percentageWasteDiversion >= 25 ? "green" : "red"}>{detailViewRecord.percentageWasteDiversion != null ? `${detailViewRecord.percentageWasteDiversion.toFixed(1)}%` : "—"}</Tag></Descriptions.Item>
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
            { key: "compliance", label: <span style={{ color: "#eb2f96" }}><SafetyCertificateOutlined /> Report Tracking</span>, children: (
              <Descriptions column={2} size="small" bordered>
                <Descriptions.Item label="Report Prepared">{detailViewRecord.dateReportPrepared ? dayjs(detailViewRecord.dateReportPrepared).format("MMM D, YYYY") : "—"}</Descriptions.Item>
                <Descriptions.Item label="Reviewed (Staff)">{detailViewRecord.dateReportReviewedStaff ? dayjs(detailViewRecord.dateReportReviewedStaff).format("MMM D, YYYY") : "—"}</Descriptions.Item>
                <Descriptions.Item label="Reviewed (Focal)">{detailViewRecord.dateReportReviewedFocal ? dayjs(detailViewRecord.dateReportReviewedFocal).format("MMM D, YYYY") : "—"}</Descriptions.Item>
                <Descriptions.Item label="Approved">{detailViewRecord.dateReportApproved ? dayjs(detailViewRecord.dateReportApproved).format("MMM D, YYYY") : "—"}</Descriptions.Item>
                <Descriptions.Item label="Tracking">{detailViewRecord.trackingOfReports || "—"}</Descriptions.Item>
              </Descriptions>
            )},
          ]} />
          </>
        )}
      </Modal>

      <Modal title={editing ? "Edit LGU Record" : "Add LGU Record"} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={handleSave} width={800} style={{ maxWidth: "95vw" }} okText={editing ? "Update" : "Create"}>
        <Form form={form} layout="vertical" size="small">
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={8}><Form.Item name="dataYear" label="Data Year" rules={[{ required: true }]}><Select options={Array.from({length:7},(_,i)=>{ const y=new Date().getFullYear()-i; return {label:y,value:y}; })} placeholder="Select Year" /></Form.Item></Col>
          </Row>
          <Collapse defaultActiveKey={["location","waste","personnel","monitoring"]} bordered={false} items={[
            { key: "location", label: <span style={{ color: "#1677ff" }}><EnvironmentOutlined /> Location</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={12}><Form.Item name="province" label="Province" rules={[{ required: true }]}><Select options={provinceOptions} placeholder="Select Province" /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="lgu" label="LGU" rules={[{ required: true }]}><Input /></Form.Item></Col>
              </Row>
            )},
            { key: "waste", label: <span style={{ color: "#fa8c16" }}><PieChartOutlined /> Waste Data</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={8}><Form.Item name="totalWasteGeneration" label="Waste Generated"><InputNumber style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="totalWasteDiverted" label="Waste Diverted"><InputNumber style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="percentageWasteDiversion" label="Diversion %"><InputNumber style={{ width: "100%" }} min={0} max={100} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="statusAccomplishment" label="Status"><Input /></Form.Item></Col>
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
          ]} />
        </Form>
      </Modal>
    </div>
  );
}
