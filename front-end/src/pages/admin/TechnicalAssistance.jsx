import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card, Table, Button, Modal, Form, Input, InputNumber, Select, Space, Tag,
  Row, Col, Typography, DatePicker, Tooltip, Collapse, Statistic, Descriptions, Popconfirm,
} from "antd";
import {
  PlusOutlined, EditOutlined, DownloadOutlined, SearchOutlined, EyeOutlined,
  CheckCircleOutlined, CloseCircleOutlined, EnvironmentOutlined, FileTextOutlined,
  ReloadOutlined, TeamOutlined, CalendarOutlined, UserOutlined, SolutionOutlined,
  SafetyCertificateOutlined, FilterOutlined, ClearOutlined, ToolOutlined,
  BankOutlined, DeleteOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import secureStorage from "../../utils/secureStorage";
import { fetchWithCache, invalidateCache } from "../../utils/pageCache";
import { useDataRef } from "../../utils/dataRef";
import dayjs from "dayjs";

const { Title, Text } = Typography;
const CACHE_KEY = "technical-assistance-cache";
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
    totalDaysReportPrepared: networkDays(rec.dateConducted, rec.dateReportPrepared),
    totalDaysReviewedStaff: networkDays(rec.dateReportPrepared, rec.dateReportReviewedStaff),
    totalDaysReviewedFocal: networkDays(rec.dateReportReviewedStaff || rec.dateReportPrepared, rec.dateReportReviewedFocal),
    totalDaysApproved: networkDays(rec.dateReportReviewedFocal, rec.dateReportApproved),
  };
}
function getStatusTag(v) {
  if (!v) return <Tag color="default">—</Tag>;
  if (/operational|compliant|completed|conducted/i.test(v) && !/non|not/i.test(v)) return <Tag color="green" bordered={false}><CheckCircleOutlined /> {v}</Tag>;
  if (/non|not|pending/i.test(v)) return <Tag color="red" bordered={false}><CloseCircleOutlined /> {v}</Tag>;
  return <Tag bordered={false}>{v}</Tag>;
}

export default function TechnicalAssistance({canEdit = true, canDelete = true, isDark}) {
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
  const [filterFacility, setFilterFacility] = useState(null);
  const [form] = Form.useForm();

  const fetchRecords = useCallback(async (skipCache = false) => {
    await fetchWithCache(CACHE_KEY, () => api.get("/technical-assistance").then(({ data }) => data), {
      ttl: CACHE_TTL,
      force: skipCache,
      onData:  (data) => setRecords(data.map((r) => ({ ...r, ...computeFields(r) }))),
      onError: ()     => Swal.fire("Error", "Failed to load records", "error"),
      onStart: ()     => setLoading(true),
      onEnd:   ()     => setLoading(false),
    });
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // Fetch cross-year history when viewing a record
  useEffect(() => {
    if (!detailModal) { setDetailYearRecords([]); setDetailYear(null); return; }
    const name = detailModal.municipality;
    api.get(`/technical-assistance/history/${encodeURIComponent(name)}`)
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
        dateReportPrepared: values.dateReportPrepared?.toISOString(),
        dateReportReviewedStaff: values.dateReportReviewedStaff?.toISOString(),
        dateReportReviewedFocal: values.dateReportReviewedFocal?.toISOString(),
        dateReportApproved: values.dateReportApproved?.toISOString(),
      };
      Object.assign(payload, computeFields(payload));
      if (editing) {
        const { data } = await api.put(`/technical-assistance/${editing._id}`, payload);
        setRecords((prev) => prev.map((r) => r._id === editing._id ? { ...data, ...computeFields(data) } : r));
        secureStorage.remove(CACHE_KEY);
        Swal.fire("Updated", "Record updated successfully", "success");
      } else {
        await api.post("/technical-assistance", payload);
        secureStorage.remove(CACHE_KEY);
        Swal.fire("Created", "Record added successfully", "success");
        fetchRecords();
      }
    } catch (err) { if (err.response) Swal.fire("Error", err.response.data?.message || "Save failed", "error"); }
    setModalOpen(false);
  };

  const handleDelete = (record) => {
    Swal.fire({ title: "Delete this record?", text: `${record.barangay}, ${record.municipality}`, icon: "warning", showCancelButton: true, confirmButtonColor: "#ff4d4f", confirmButtonText: "Delete" })
      .then(async (result) => { if (result.isConfirmed) { await api.delete(`/technical-assistance/${record._id}`); secureStorage.remove(CACHE_KEY); setRecords((prev) => prev.filter((r) => r._id !== record._id)); Swal.fire("Deleted", "Record deleted", "success"); } });
  };

  const hasActiveFilters = filterProvince || filterMBA || filterStatus || filterMonth || filterFacility || searchText;
  const clearAllFilters = () => { setFilterProvince(null); setFilterMBA(null); setFilterStatus(null); setFilterMonth(null); setFilterFacility(null); setSearchText(""); };

  const filtered = useMemo(() => {
    let data = records;
    if (searchText) { const s = searchText.toLowerCase(); data = data.filter((r) => [r.province, r.municipality, r.barangay, r.focalPerson, r.enmoAssigned, r.typeOfFacility, r.status].some((v) => v && v.toLowerCase().includes(s))); }
    if (filterProvince) data = data.filter((r) => r.province === filterProvince);
    if (filterMBA) data = data.filter((r) => r.manilaBayArea === filterMBA);
    if (filterStatus) data = data.filter((r) => r.status === filterStatus);
    if (filterMonth) data = data.filter((r) => r.targetMonth === filterMonth);
    if (filterFacility) data = data.filter((r) => r.typeOfFacility === filterFacility);
    return data;
  }, [records, searchText, filterProvince, filterMBA, filterStatus, filterMonth, filterFacility]);

  const filters = useMemo(() => ({
    province: buildFilters(records, "province"),
    manilaBayArea: buildFilters(records, "manilaBayArea"),
    status: buildFilters(records, "status"),
    targetMonth: buildFilters(records, "targetMonth"),
    typeOfFacility: buildFilters(records, "typeOfFacility"),
  }), [records]);

  const columns = [
    {
      title: <span><EnvironmentOutlined style={{ color: isDark ? "#7eb8da" : "#1a3353" }} /> Location</span>, key: "location", width: 180, fixed: "left",
      filters: filters.province, onFilter: (v, r) => r.province === v,
      sorter: (a, b) => (a.barangay || "").localeCompare(b.barangay || ""),
      render: (_, r) => (
        <Tooltip title={`${r.province} — ${r.municipality} — ${r.barangay || ""}`}>
          <div style={{ lineHeight: 1.3 }}>
            <Text strong style={{ fontSize: 12 }}>{r.barangay || r.municipality}</Text><br />
            <Text type="secondary" style={{ fontSize: 10 }}>{r.municipality}{r.barangay ? `, ${r.province}` : ""}</Text>
          </div>
        </Tooltip>
      ),
    },
    { title: "MBA", dataIndex: "manilaBayArea", key: "mba", width: 80,
      filters: filters.manilaBayArea, onFilter: (v, r) => r.manilaBayArea === v,
      render: (v) => v === "MBA" ? <Tag color="blue" bordered={false}>MBA</Tag> : <Tag color="default" bordered={false}>{v || "—"}</Tag>,
    },
    { title: <span><BankOutlined style={{ color: "#2f54eb" }} /> Facility Type</span>, dataIndex: "typeOfFacility", key: "facility", width: 140,
      filters: filters.typeOfFacility, onFilter: (v, r) => r.typeOfFacility === v,
      render: (v) => v ? <Tag bordered={false} color="geekblue">{v}</Tag> : "—",
    },
    { title: "Status", dataIndex: "status", key: "status", width: 130,
      filters: filters.status, onFilter: (v, r) => r.status === v,
      render: (v) => getStatusTag(v),
    },
    { title: "Year", dataIndex: "yearMonitored", key: "year", width: 70,
      sorter: (a, b) => (a.yearMonitored || 0) - (b.yearMonitored || 0),
      render: (v) => v || "—",
    },
    { title: "Date Conducted", dataIndex: "dateConducted", key: "dateConducted", width: 110,
      render: (v) => v || "—",
    },
    { title: "Tech Con", dataIndex: "conductedTechCon", key: "techCon", width: 100,
      render: (v) => v ? <Tag bordered={false} color={/yes/i.test(v) ? "green" : "default"}>{v}</Tag> : "—",
    },
    {
      title: <span><TeamOutlined style={{ color: "#722ed1" }} /> Personnel</span>, key: "personnel", width: 150,
      render: (_, r) => (
        <Tooltip title={<div><div>Focal: {r.focalPerson || "—"}</div><div>Staff: {r.eswmStaff || "—"}</div><div>ENMO: {r.enmoAssigned || "—"}</div></div>}>
          <div style={{ lineHeight: 1.3 }}>
            <Text style={{ fontSize: 11 }}><UserOutlined style={{ color: "#722ed1", marginRight: 4 }} />{r.focalPerson || "—"}</Text><br />
            <Text type="secondary" style={{ fontSize: 10 }}><SolutionOutlined style={{ marginRight: 3 }} />{r.enmoAssigned || "—"}</Text>
          </div>
        </Tooltip>
      ),
    },
    { title: "Target Month", dataIndex: "targetMonth", key: "targetMonth", width: 100,
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
          {canDelete && <Popconfirm title="Delete this record?" onConfirm={() => handleDelete(record)} okText="Delete" okButtonProps={{ danger: true }}><Tooltip title="Delete"><Button type="text" size="small" danger icon={<DeleteOutlined />} /></Tooltip></Popconfirm>}
        </Space>
      ),
    },
  ];

  const mbaCount = filtered.filter((r) => r.manilaBayArea === "MBA").length;
  const provinceCount = new Set(filtered.map((r) => r.province).filter(Boolean)).size;
  const facilityTypes = useMemo(() => { const m = {}; filtered.forEach((r) => { const t = r.typeOfFacility || "Unknown"; m[t] = (m[t] || 0) + 1; }); return m; }, [filtered]);
  const techConCount = filtered.filter((r) => /yes/i.test(r.conductedTechCon)).length;

  return (
    <div>
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .ta-card { animation: fadeInUp 0.5s ease-out both; }
        .ta-icon-bounce { display: inline-block; transition: transform 0.2s; cursor: default; }
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <Title level={4} style={{ margin: 0 }}><ToolOutlined /> Technical Assistance (Barangay)</Title>
        <Space wrap>
          <Input placeholder="Search..." prefix={<SearchOutlined />} value={searchText} onChange={(e) => setSearchText(e.target.value)} style={{ width: "100%", maxWidth: 200 }} allowClear />
          {canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>Add Record</Button>}
          <Button icon={<DownloadOutlined />} onClick={() => {
            exportToExcel(filtered.map((r) => ({
              Province: r.province, Municipality: r.municipality, Barangay: r.barangay, MBA: r.manilaBayArea,
              "Facility Type": r.typeOfFacility, Status: r.status, Year: r.yearMonitored,
              "Date Conducted": r.dateConducted, "Tech Con": r.conductedTechCon,
              "ENMO": r.enmoAssigned, "Staff": r.eswmStaff, "Focal": r.focalPerson,
              "Target Month": r.targetMonth, Remarks: r.remarks,
            })), "TechnicalAssistance");
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
              <Select placeholder="Status" value={filterStatus} onChange={setFilterStatus} allowClear style={{ width: "100%", minWidth: 120, maxWidth: 180 }} size="small" options={filters.status.map((f) => ({ label: f.text, value: f.value }))} />
              <Select placeholder="Facility Type" value={filterFacility} onChange={setFilterFacility} allowClear style={{ width: "100%", minWidth: 110, maxWidth: 160 }} size="small" options={filters.typeOfFacility.map((f) => ({ label: f.text, value: f.value }))} />
              <Select placeholder="Target Month" value={filterMonth} onChange={setFilterMonth} allowClear style={{ width: "100%", minWidth: 110, maxWidth: 150 }} size="small" options={monthOptions} />
              {hasActiveFilters && <Tooltip title="Clear all filters"><Button size="small" type="link" danger icon={<ClearOutlined />} onClick={clearAllFilters}>Clear</Button></Tooltip>}
            </Space>
          </Col>
          <Col><Tag bordered={false} color={hasActiveFilters ? "blue" : "default"}>{filtered.length} / {records.length} records</Tag></Col>
        </Row>
      </Card>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="ta-card" style={{ borderRadius: 10, borderLeft: isDark ? "3px solid #4a7fb5" : "3px solid #1a3353", height: "100%" }}>
            <Statistic title="Total Records" value={filtered.length} prefix={<ToolOutlined className="ta-icon-bounce" style={{ color: isDark ? "#7eb8da" : "#1a3353" }} />} />
            <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
              <Tag color="blue" bordered={false}>MBA {mbaCount}</Tag>
              <Tag color="purple" bordered={false}>{provinceCount} Provinces</Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="ta-card" style={{ borderRadius: 10, borderLeft: "3px solid #52c41a", height: "100%", animationDelay: "0.07s" }}>
            <Statistic title="Tech Con Conducted" value={techConCount} suffix={`/ ${filtered.length}`} prefix={<CheckCircleOutlined className="ta-icon-bounce" style={{ color: "#52c41a" }} />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="ta-card" style={{ borderRadius: 10, borderLeft: "3px solid #1890ff", height: "100%", animationDelay: "0.14s" }}>
            <Statistic title="Facility Types" value={Object.keys(facilityTypes).length} prefix={<BankOutlined className="ta-icon-bounce" style={{ color: "#1890ff" }} />} />
            <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
              {Object.entries(facilityTypes).slice(0, 3).map(([k, v]) => (<Tag key={k} bordered={false}>{k}: {v}</Tag>))}
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" hoverable className="ta-card" style={{ borderRadius: 10, borderLeft: "3px solid #faad14", height: "100%", animationDelay: "0.21s" }}>
            <Statistic title="With Reports" value={filtered.filter((r) => r.dateReportPrepared).length} suffix={`/ ${filtered.length}`} prefix={<CalendarOutlined className="ta-icon-bounce" style={{ color: "#faad14" }} />} />
          </Card>
        </Col>
      </Row>

      <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: 0 }}>
        <Table dataSource={filtered} columns={columns} rowKey="_id" size="small" loading={loading} scroll={{ x: 1200 }}
          pagination={{ defaultPageSize: 25, pageSizeOptions: ["10", "25", "50", "100", "200"], showSizeChanger: true, showTotal: (t, r) => `${r[0]}-${r[1]} of ${t}` }} />
      </Card>

      <Modal title={<Space><FileTextOutlined />{detailModal?.municipality}, {detailModal?.province}{detailYearRecords.length >= 1 && <Tag color="blue" bordered={false} style={{ marginLeft: 8 }}>{detailYearRecords.length} year records</Tag>}</Space>} open={!!detailModal} onCancel={() => setDetailModal(null)} footer={<Button onClick={() => setDetailModal(null)}>Close</Button>} width={750} style={{ maxWidth: "95vw" }}>
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
          <Collapse defaultActiveKey={["general","details","monitoring","monitoring2","reports"]} bordered={false} items={[
            { key: "general", label: <span style={{ color: "#1677ff" }}><EnvironmentOutlined /> General Info</span>, children: (
              <Descriptions column={3} size="small" bordered>
                <Descriptions.Item label="Province">{detailViewRecord.province}</Descriptions.Item>
                <Descriptions.Item label="Municipality">{detailViewRecord.municipality}</Descriptions.Item>
                <Descriptions.Item label="Barangay">{detailViewRecord.barangay || "—"}</Descriptions.Item>
                <Descriptions.Item label="MBA">{detailViewRecord.manilaBayArea === "MBA" ? <Tag color="blue" bordered={false}>MBA</Tag> : (detailViewRecord.manilaBayArea || "—")}</Descriptions.Item>
              </Descriptions>
            )},
            { key: "details", label: <span style={{ color: "#fa8c16" }}><ToolOutlined /> Technical Details</span>, children: (
              <Descriptions column={2} size="small" bordered>
                <Descriptions.Item label="Facility Type"><Tag bordered={false} color="geekblue">{detailViewRecord.typeOfFacility || "—"}</Tag></Descriptions.Item>
                <Descriptions.Item label="Status">{getStatusTag(detailViewRecord.status)}</Descriptions.Item>
                <Descriptions.Item label="Year Monitored">{detailViewRecord.yearMonitored || "—"}</Descriptions.Item>
                <Descriptions.Item label="Date Conducted">{detailViewRecord.dateConducted || "—"}</Descriptions.Item>
                <Descriptions.Item label="Tech Con Conducted"><Tag bordered={false} color={/yes/i.test(detailViewRecord.conductedTechCon) ? "green" : "default"}>{detailViewRecord.conductedTechCon || "—"}</Tag></Descriptions.Item>
                <Descriptions.Item label="Remarks" span={2}>{detailViewRecord.remarks || "—"}</Descriptions.Item>
              </Descriptions>
            )},
            { key: "monitoring", label: <span style={{ color: "#13c2c2" }}><TeamOutlined /> Personnel</span>, children: (
              <Descriptions column={3} size="small" bordered>
                <Descriptions.Item label="Focal">{detailViewRecord.focalPerson || "—"}</Descriptions.Item>
                <Descriptions.Item label="Staff">{detailViewRecord.eswmStaff || "—"}</Descriptions.Item>
                <Descriptions.Item label="ENMO">{detailViewRecord.enmoAssigned || "—"}</Descriptions.Item>
              </Descriptions>
            )},
            { key: "monitoring2", label: <span style={{ color: "#13c2c2" }}><TeamOutlined /> Schedule</span>, children: (
              <Descriptions column={2} size="small" bordered>
                <Descriptions.Item label="Target Month">{detailViewRecord.targetMonth || "—"}</Descriptions.Item>
                <Descriptions.Item label="IIS Number">{detailViewRecord.iisNumber || "—"}</Descriptions.Item>
              </Descriptions>
            )},
            { key: "reports", label: <span style={{ color: "#eb2f96" }}><SafetyCertificateOutlined /> Report Tracking</span>, children: (
              <Descriptions column={2} size="small" bordered>
                <Descriptions.Item label="Report Prepared">{detailViewRecord.dateReportPrepared ? dayjs(detailViewRecord.dateReportPrepared).format("MM/DD/YYYY") : "—"}</Descriptions.Item>
                <Descriptions.Item label="Reviewed (Staff)">{detailViewRecord.dateReportReviewedStaff ? dayjs(detailViewRecord.dateReportReviewedStaff).format("MM/DD/YYYY") : "—"}</Descriptions.Item>
                <Descriptions.Item label="Reviewed (Focal)">{detailViewRecord.dateReportReviewedFocal ? dayjs(detailViewRecord.dateReportReviewedFocal).format("MM/DD/YYYY") : "—"}</Descriptions.Item>
                <Descriptions.Item label="Approved">{detailViewRecord.dateReportApproved ? dayjs(detailViewRecord.dateReportApproved).format("MM/DD/YYYY") : "—"}</Descriptions.Item>
                <Descriptions.Item label="Tracking">{detailViewRecord.trackingOfReports || "—"}</Descriptions.Item>
              </Descriptions>
            )},
          ]} />
          </>
        )}
      </Modal>

      <Modal title={editing ? "Edit Technical Assistance" : "Add Technical Assistance"} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={handleSave} width={900} style={{ maxWidth: "95vw" }} okText={editing ? "Update" : "Create"}>
        <Form form={form} layout="vertical" size="small">
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={8}><Form.Item name="dataYear" label="Data Year" rules={[{ required: true }]}><Select options={Array.from({length:7},(_,i)=>{ const y=new Date().getFullYear()-i; return {label:y,value:y}; })} placeholder="Select Year" /></Form.Item></Col>
          </Row>
          <Collapse defaultActiveKey={["location","details","personnel","monitoring"]} bordered={false} items={[
            { key: "location", label: <span style={{ color: "#1677ff" }}><EnvironmentOutlined /> Location</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={8}><Form.Item name="province" label="Province" rules={[{ required: true }]}><Select options={provinceOptions} placeholder="Select Province" /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="municipality" label="Municipality" rules={[{ required: true }]}><Input /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="barangay" label="Barangay"><Input /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="manilaBayArea" label="Manila Bay Area"><Select options={mbaOptions} allowClear /></Form.Item></Col>
              </Row>
            )},
            { key: "details", label: <span style={{ color: "#fa8c16" }}><ToolOutlined /> Details</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={12}><Form.Item name="typeOfFacility" label="Facility Type"><Input /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="status" label="Status"><Input /></Form.Item></Col>
                <Col xs={12} sm={8}><Form.Item name="yearMonitored" label="Year Monitored"><InputNumber style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateConducted" label="Date Conducted"><Input /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="conductedTechCon" label="Tech Con Conducted"><Input /></Form.Item></Col>
                <Col span={24}><Form.Item name="remarks" label="Remarks"><Input.TextArea rows={2} /></Form.Item></Col>
              </Row>
            )},
            { key: "personnel", label: <span style={{ color: "#52c41a" }}><TeamOutlined /> Personnel</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={8}><Form.Item name="enmoAssigned" label="ENMO"><Select options={enmoOptions} allowClear showSearch /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="eswmStaff" label="ESWM Staff"><Select options={eswmStaffOptions} allowClear showSearch /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="focalPerson" label="Focal Person"><Select options={focalOptions} allowClear showSearch /></Form.Item></Col>
              </Row>
            )},
            { key: "monitoring", label: <span style={{ color: "#13c2c2" }}><CalendarOutlined /> Monitoring & Reports</span>, children: (
              <Row gutter={16}>
                <Col xs={24} sm={8}><Form.Item name="targetMonth" label="Target Month"><Select options={monthOptions} allowClear /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="iisNumber" label="IIS Number"><Input /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateReportPrepared" label="Report Prepared"><DatePicker format="MM/DD/YYYY" style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateReportReviewedStaff" label="Reviewed (Staff)"><DatePicker format="MM/DD/YYYY" style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateReportReviewedFocal" label="Reviewed (Focal)"><DatePicker format="MM/DD/YYYY" style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={8}><Form.Item name="dateReportApproved" label="Report Approved"><DatePicker format="MM/DD/YYYY" style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="trackingOfReports" label="Tracking"><Input /></Form.Item></Col>
              </Row>
            )},
          ]} />
        </Form>
      </Modal>
    </div>
  );
}
