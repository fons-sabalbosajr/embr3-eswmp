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
  Descriptions,
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
  Popconfirm,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  CarOutlined,
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
  VideoCameraOutlined,
  ScissorOutlined,
  ExperimentOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import secureStorage from "../../utils/secureStorage";
import { fetchWithCache, invalidateCache } from "../../utils/pageCache";
import { useDataRef } from "../../utils/dataRef";
import dayjs from "dayjs";

const { Title, Text } = Typography;

const CACHE_KEY = "swm-equip-cache";
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

export default function SwmEquipment({canEdit = true, canDelete = true, isDark}) {
  const { getValues } = useDataRef();
  const provinceOptions = getValues("province").map((p) => ({ label: p, value: p }));
  const monthOptions = getValues("target-month").map((m) => ({ label: m.replace(/^\d+\./, ""), value: m }));
  const mbaOptions = getValues("manila-bay-area").map((v) => ({ label: v, value: v }));
  const equipStatusOptions = getValues("equipment-status").map((v) => ({ label: v, value: v }));
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
  const [filterType, setFilterType] = useState(null);
  const [filterMonth, setFilterMonth] = useState(null);
  const [form] = Form.useForm();

  const fetchRecords = useCallback(async (skipCache = false) => {
    await fetchWithCache(CACHE_KEY, () => api.get("/swm-equipment").then(({ data }) => data), {
      ttl: CACHE_TTL,
      force: skipCache,
      onData:  (data) => setRecords(data.map((r) => ({ ...r, ...computeFields(r) }))),
      onError: ()     => Swal.fire("Error", "Failed to load records", "error"),
      onStart: ()     => setLoading(true),
      onEnd:   ()     => setLoading(false),
    });
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // Fetch cross-year history when viewing a record
  useEffect(() => {
    if (!detailModal) { setDetailYearRecords([]); setDetailYear(null); return; }
    const name = detailModal.municipality;
    api.get(`/swm-equipment/history/${encodeURIComponent(name)}`)
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
    form.setFieldsValue({
      ...record,
      dateOfMonitoring: record.dateOfMonitoring
        ? dayjs(record.dateOfMonitoring)
        : null,
      dateReportPrepared: record.dateReportPrepared
        ? dayjs(record.dateReportPrepared)
        : null,
      dateReportReviewedStaff: record.dateReportReviewedStaff
        ? dayjs(record.dateReportReviewedStaff)
        : null,
      dateReportReviewedFocal: record.dateReportReviewedFocal
        ? dayjs(record.dateReportReviewedFocal)
        : null,
      dateReportApproved: record.dateReportApproved
        ? dayjs(record.dateReportApproved)
        : null,
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
        const { data } = await api.put(
          `/swm-equipment/${editing._id}`,
          payload,
        );
        setRecords((prev) =>
          prev.map((r) =>
            r._id === editing._id ? { ...data, ...computeFields(data) } : r,
          ),
        );
        secureStorage.remove(CACHE_KEY);
        secureStorage.invalidateDashboard();
        Swal.fire("Updated", "Record updated successfully", "success");
      } else {
        await api.post("/swm-equipment", payload);
        secureStorage.remove(CACHE_KEY);
        secureStorage.invalidateDashboard();
        Swal.fire("Created", "Record added successfully", "success");
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

  const handleDelete = (record) => {
    Swal.fire({ title: "Delete this record?", text: `${record.municipality}, ${record.province}`, icon: "warning", showCancelButton: true, confirmButtonColor: "#ff4d4f", confirmButtonText: "Delete" })
      .then(async (result) => { if (result.isConfirmed) { await api.delete(`/swm-equipment/${record._id}`); secureStorage.remove(CACHE_KEY); setRecords((prev) => prev.filter((r) => r._id !== record._id)); Swal.fire("Deleted", "Record deleted", "success"); } });
  };

  const hasActiveFilters =
    filterProvince || filterMBA || filterType || filterMonth || searchText;
  const clearAllFilters = () => {
    setFilterProvince(null);
    setFilterMBA(null);
    setFilterType(null);
    setFilterMonth(null);
    setSearchText("");
  };

  const filtered = useMemo(() => {
    let data = records;
    if (searchText) {
      const q = searchText.toLowerCase();
      data = data.filter((r) =>
        [
          r.province,
          r.municipality,
          r.barangay,
          r.enmoAssigned,
          r.focalPerson,
          r.typeOfEquipment,
        ].some((v) => v && v.toLowerCase().includes(q)),
      );
    }
    if (filterProvince)
      data = data.filter((r) => r.province === filterProvince);
    if (filterMBA) data = data.filter((r) => r.manilaBayArea === filterMBA);
    if (filterType) data = data.filter((r) => r.typeOfEquipment === filterType);
    if (filterMonth) data = data.filter((r) => r.targetMonth === filterMonth);
    return data;
  }, [records, searchText, filterProvince, filterMBA, filterType, filterMonth]);

  const filters = useMemo(
    () => ({
      province: buildFilters(records, "province"),
      manilaBayArea: buildFilters(records, "manilaBayArea"),
      typeOfEquipment: buildFilters(records, "typeOfEquipment"),
      statusOfBioShredder: buildFilters(records, "statusOfBioShredder"),
      statusOfBioComposter: buildFilters(records, "statusOfBioComposter"),
      targetMonth: buildFilters(records, "targetMonth"),
    }),
    [records],
  );

  const bioShredderOp = filtered.filter(
    (r) =>
      /operational/i.test(r.statusOfBioShredder) &&
      !/non/i.test(r.statusOfBioShredder),
  ).length;
  const bioComposterOp = filtered.filter(
    (r) =>
      /operational/i.test(r.statusOfBioComposter) &&
      !/non/i.test(r.statusOfBioComposter),
  ).length;
  const totalSoilEnhancer = filtered.reduce(
    (s, r) => s + (r.weightOfSoilEnhancer || 0),
    0,
  );
  const totalChairs = filtered.reduce(
    (s, r) => s + (r.noPlasticChairProduced || 0),
    0,
  );
  const cctvOp = filtered.filter(
    (r) => /operational/i.test(r.statusOfCCTV) && !/non/i.test(r.statusOfCCTV),
  ).length;
  const mbaCount = filtered.filter((r) => r.manilaBayArea === "MBA").length;
  const provinceCount = new Set(filtered.map((r) => r.province).filter(Boolean))
    .size;
  const totalEquipOp = bioShredderOp + bioComposterOp;
  const totalEquipAll = filtered.length * 2;
  const operationalRate =
    totalEquipAll > 0 ? (totalEquipOp / totalEquipAll) * 100 : 0;

  const columns = [
    {
      title: (
        <span>
          <EnvironmentOutlined style={{ color: isDark ? "#7eb8da" : "#1a3353" }} /> LGU
        </span>
      ),
      key: "lgu",
      width: 160,
      fixed: "left",
      filters: filters.province,
      onFilter: (v, r) => r.province === v,
      sorter: (a, b) =>
        (a.municipality || "").localeCompare(b.municipality || ""),
      render: (_, r) => (
        <Tooltip
          title={`${r.province} — ${r.municipality}${r.barangay ? ` (${r.barangay})` : ""}`}
        >
          <div style={{ lineHeight: 1.3 }}>
            <Text strong style={{ fontSize: 12 }}>
              {r.municipality}
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
      key: "mba",
      width: 100,
      filters: filters.manilaBayArea,
      onFilter: (v, r) => r.manilaBayArea === v,
      render: (v) =>
        v === "MBA" ? (
          <Tag color="blue" bordered={false}>
            MBA
          </Tag>
        ) : (
          <Tag color="default" bordered={false}>
            {v || "—"}
          </Tag>
        ),
    },
    {
      title: (
        <span>
          <CarOutlined style={{ color: "#fa8c16" }} /> Equipment Type
        </span>
      ),
      dataIndex: "typeOfEquipment",
      key: "typeOfEquipment",
      width: 250,
      filters: filters.typeOfEquipment,
      onFilter: (v, r) => r.typeOfEquipment === v,
      render: (v) =>
        v ? (
          <Tag color="orange" bordered={false}>
            {v}
          </Tag>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: (
        <span>
          <ExperimentOutlined style={{ color: "#52c41a" }} /> Bio Equipment
        </span>
      ),
      key: "bioEquipment",
      width: 170,
      filters: [...new Set([
        ...(filters.statusOfBioShredder || []).map((f) => f.value),
        ...(filters.statusOfBioComposter || []).map((f) => f.value),
      ])].sort().map((v) => ({ text: v, value: v })),
      onFilter: (v, r) => r.statusOfBioShredder === v || r.statusOfBioComposter === v,
      render: (_, r) => (
        <Tooltip title={<div><div>Bio-Shredder: {r.statusOfBioShredder || "—"}</div><div>Bio-Composter: {r.statusOfBioComposter || "—"}</div></div>}>
          <div style={{ lineHeight: 1.5 }}>
            <div style={{ fontSize: 11 }}><ScissorOutlined style={{ color: "#fa8c16", marginRight: 4 }} />{getStatusTag(r.statusOfBioShredder)}</div>
            <div style={{ fontSize: 11 }}><ExperimentOutlined style={{ color: "#52c41a", marginRight: 4 }} />{getStatusTag(r.statusOfBioComposter)}</div>
          </div>
        </Tooltip>
      ),
    },
    {
      title: (
        <span>
          <BarChartOutlined style={{ color: "#722ed1" }} /> Soil Enhancer
        </span>
      ),
      dataIndex: "weightOfSoilEnhancer",
      key: "soil",
      width: 130,
      sorter: (a, b) =>
        (a.weightOfSoilEnhancer || 0) - (b.weightOfSoilEnhancer || 0),
      render: (v) =>
        v != null ? (
          <Text strong style={{ color: "#fa8c16" }}>
            {Number(v).toLocaleString()} kg
          </Text>
        ) : (
          "—"
        ),
    },
    {
      title: (
        <span>
          <VideoCameraOutlined style={{ color: "#eb2f96" }} /> CCTV
        </span>
      ),
      dataIndex: "statusOfCCTV",
      key: "cctv",
      width: 110,
      render: (v) => getStatusTag(v),
    },
    {
      title: (
        <span>
          <SafetyCertificateOutlined style={{ color: "#13c2c2" }} /> Chairs
        </span>
      ),
      key: "chairs",
      width: 130,
      sorter: (a, b) =>
        (a.noPlasticChairProduced || 0) - (b.noPlasticChairProduced || 0),
      render: (_, r) => (
        <Tooltip title={`Factory: ${r.statusOfPlasticChairFactory || "—"}`}>
          <div style={{ lineHeight: 1.3 }}>
            <Text strong style={{ fontSize: 12 }}>
              {r.noPlasticChairProduced != null
                ? Number(r.noPlasticChairProduced).toLocaleString()
                : "—"}
            </Text>
            <br />
            <Text type="secondary" style={{ fontSize: 10 }}>
              {getStatusTag(r.statusOfPlasticChairFactory)}
            </Text>
          </div>
        </Tooltip>
      ),
    },
    {
      title: (
        <span>
          <TeamOutlined style={{ color: "#722ed1" }} /> Personnel
        </span>
      ),
      key: "personnel",
      width: 170,
      render: (_, r) => (
        <Tooltip
          title={
            <div>
              <div>
                <UserOutlined /> Focal: {r.focalPerson || "—"}
              </div>
              <div>
                <SolutionOutlined /> ENMO: {r.enmoAssigned || "—"}
              </div>
            </div>
          }
        >
          <div style={{ lineHeight: 1.3 }}>
            <Text style={{ fontSize: 11 }}>
              <UserOutlined style={{ color: "#722ed1", marginRight: 4 }} />
              {r.focalPerson || "—"}
            </Text>
            <br />
            <Text type="secondary" style={{ fontSize: 10 }}>
              <SolutionOutlined style={{ marginRight: 3 }} />
              {r.enmoAssigned || "—"}
            </Text>
          </div>
        </Tooltip>
      ),
    },
    {
      title: (
        <span>
          <CalendarOutlined style={{ color: "#13c2c2" }} /> Target Month
        </span>
      ),
      dataIndex: "targetMonth",
      key: "targetMonth",
      width: 110,
      filters: filters.targetMonth,
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
        <span>
          <ClockCircleOutlined style={{ color: "#1890ff" }} /> Monitoring
        </span>
      ),
      dataIndex: "dateOfMonitoring",
      key: "monitoring",
      width: 120,
      render: (v) => (v ? dayjs(v).format("MM/DD/YYYY") : "—"),
    },
    {
      title: "Actions",
      key: "actions",
      width: 80,
      fixed: "right",
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="View Details">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined style={{ color: "#1890ff" }} />}
              onClick={() => setDetailModal(r)}
            />
          </Tooltip>
          {canEdit && <Tooltip title="Edit">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined style={{ color: "#52c41a" }} />}
              onClick={() => openEdit(r)}
            />
          </Tooltip>}
          {canDelete && <Popconfirm title="Delete this record?" onConfirm={() => handleDelete(r)} okText="Delete" okButtonProps={{ danger: true }}><Tooltip title="Delete"><Button type="text" size="small" danger icon={<DeleteOutlined />} /></Tooltip></Popconfirm>}
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
      District: r.congressionalDistrict,
      "Equipment Type": r.typeOfEquipment,
      "Bio-Shredder": r.statusOfBioShredder,
      "Bio-Composter": r.statusOfBioComposter,
      "Soil Enhancer (kg)": r.weightOfSoilEnhancer,
      CCTV: r.statusOfCCTV,
      "Chair Factory": r.statusOfPlasticChairFactory,
      "Chairs Produced": r.noPlasticChairProduced,
      "Target Month": r.targetMonth,
      ENMO: r.enmoAssigned,
      "Focal Person": r.focalPerson,
    }));
    exportToExcel(rows, "SWM_Equipment_Data");
  };

  return (
    <div>
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        @keyframes subtleBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        .equip-card { animation: fadeInUp 0.5s ease-out both; }
        .equip-tag-pulse { animation: pulse 2.5s ease-in-out infinite; }
        .equip-icon-bounce { display: inline-block; transition: transform 0.2s; cursor: default; }
        .equip-icon-bounce:hover { animation: subtleBounce 0.4s ease; }
      `}</style>

      {/* Header */}
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
          <CarOutlined /> SWM Equipment
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
            style={{ background: "#fa8c16", borderColor: "#fa8c16" }}
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
            <FilterOutlined style={{ color: "#fa8c16", marginRight: 6 }} />
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
                style={{ width: "100%", minWidth: 120, maxWidth: 160 }}
                size="small"
                options={provinceOptions}
                suffixIcon={<EnvironmentOutlined />}
              />
              <Select
                placeholder="MBA"
                value={filterMBA}
                onChange={setFilterMBA}
                allowClear
                style={{ width: "100%", minWidth: 100, maxWidth: 140 }}
                size="small"
                options={mbaOptions}
              />
              <Select
                placeholder="Equip. Type"
                value={filterType}
                onChange={setFilterType}
                allowClear
                style={{ width: "100%", minWidth: 130, maxWidth: 180 }}
                size="small"
                options={
                  filters.typeOfEquipment?.map((f) => ({
                    label: f.text,
                    value: f.value,
                  })) || []
                }
                suffixIcon={<CarOutlined />}
              />
              <Select
                placeholder="Target Month"
                value={filterMonth}
                onChange={setFilterMonth}
                allowClear
                style={{ width: "100%", minWidth: 110, maxWidth: 150 }}
                size="small"
                options={monthOptions}
                suffixIcon={<CalendarOutlined />}
              />
              {hasActiveFilters && (
                <Tooltip title="Clear all filters">
                  <Button
                    size="small"
                    type="link"
                    danger
                    icon={<ClearOutlined />}
                    onClick={clearAllFilters}
                  >
                    Clear
                  </Button>
                </Tooltip>
              )}
            </Space>
          </Col>
          <Col>
            <Tag bordered={false} color={hasActiveFilters ? "blue" : "default"}>
              {filtered.length} / {records.length} records
            </Tag>
          </Col>
        </Row>
      </Card>

      {/* Summary Dashboard Tiles */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card
            size="small"
            hoverable
            className="equip-card"
            style={{
              borderRadius: 10,
              borderLeft: "3px solid #fa8c16",
              height: "100%",
            }}
          >
            <Statistic
              title="Total Equipment"
              value={filtered.length}
              prefix={
                <CarOutlined
                  className="equip-icon-bounce"
                  style={{ color: "#fa8c16" }}
                />
              }
            />
            <div
              style={{
                marginTop: 8,
                display: "flex",
                gap: 4,
                flexWrap: "wrap",
              }}
            >
              <Tag color="blue" bordered={false}>
                MBA {mbaCount}
              </Tag>
              <Tag bordered={false}>Non-MBA {filtered.length - mbaCount}</Tag>
              <Tag color="purple" bordered={false}>
                {provinceCount} Provinces
              </Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card
            size="small"
            hoverable
            className="equip-card"
            style={{
              borderRadius: 10,
              borderLeft: "3px solid #52c41a",
              height: "100%",
              animationDelay: "0.07s",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <Statistic
                title="Equipment Op. Rate"
                value={operationalRate.toFixed(1)}
                suffix="%"
                prefix={
                  <CheckCircleOutlined
                    className="equip-icon-bounce"
                    style={{ color: "#52c41a" }}
                  />
                }
              />
              <Progress
                type="circle"
                percent={Math.round(operationalRate)}
                size={48}
                strokeColor={{ "0%": "#52c41a", "100%": "#87d068" }}
              />
            </div>
            <div
              style={{
                marginTop: 8,
                display: "flex",
                gap: 4,
                flexWrap: "wrap",
              }}
            >
              <Tag color="green" bordered={false} className="equip-tag-pulse">
                <CheckCircleOutlined /> Shredder {bioShredderOp}
              </Tag>
              <Tag color="blue" bordered={false} className="equip-tag-pulse">
                <ToolOutlined /> Composter {bioComposterOp}
              </Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card
            size="small"
            hoverable
            className="equip-card"
            style={{
              borderRadius: 10,
              borderLeft: "3px solid #722ed1",
              height: "100%",
              animationDelay: "0.14s",
            }}
          >
            <Statistic
              title="Soil Enhancer"
              value={totalSoilEnhancer}
              prefix={
                <BarChartOutlined
                  className="equip-icon-bounce"
                  style={{ color: "#722ed1" }}
                />
              }
              suffix="kg"
              formatter={(v) => Number(v).toLocaleString()}
            />
            <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
              <Tag color="cyan" bordered={false}>
                {totalChairs.toLocaleString()} Chairs
              </Tag>
              <Tag color="magenta" bordered={false}>
                <VideoCameraOutlined /> CCTV {cctvOp}
              </Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card
            size="small"
            hoverable
            className="equip-card"
            style={{
              borderRadius: 10,
              borderLeft: "3px solid #13c2c2",
              height: "100%",
              animationDelay: "0.21s",
            }}
          >
            <Statistic
              title="Chairs Produced"
              value={totalChairs}
              prefix={
                <SafetyCertificateOutlined
                  className="equip-icon-bounce"
                  style={{ color: "#13c2c2" }}
                />
              }
              formatter={(v) => Number(v).toLocaleString()}
            />
            <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
              <Tag color="magenta" bordered={false}>
                <VideoCameraOutlined /> CCTV Active {cctvOp}
              </Tag>
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
          scroll={{ x: 1500 }}
          pagination={{
            defaultPageSize: 15,
            pageSizeOptions: ["10", "15", "25", "50", "100"],
            showSizeChanger: true,
            showTotal: (t, r) => `${r[0]}-${r[1]} of ${t}`,
          }}
        />
      </Card>

      {/* Detail Modal */}
      <Modal
        title={
          <Space>
            <CarOutlined />
            {detailModal?.municipality}, {detailModal?.province}
            {detailYearRecords.length >= 1 && <Tag color="blue" bordered={false} style={{ marginLeft: 8 }}>{detailYearRecords.length} year records</Tag>}
          </Space>
        }
        open={!!detailModal}
        onCancel={() => setDetailModal(null)}
        footer={<Button onClick={() => setDetailModal(null)}>Close</Button>}
        width={800}
        style={{ maxWidth: "95vw" }}
      >
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
          <Tabs
            items={[
              {
                key: "general",
                label: (
                  <>
                    <EnvironmentOutlined /> General Info
                  </>
                ),
                children: (
                  <>
                    <Descriptions column={2} size="small" bordered>
                      <Descriptions.Item label="Province">{detailViewRecord.province}</Descriptions.Item>
                      <Descriptions.Item label="Municipality">{detailViewRecord.municipality}</Descriptions.Item>
                      <Descriptions.Item label="Barangay">{detailViewRecord.barangay || "—"}</Descriptions.Item>
                      <Descriptions.Item label="Manila Bay Area">{detailViewRecord.manilaBayArea === "MBA" ? (
                          <Tag color="blue" bordered={false}>MBA</Tag>
                        ) : (
                          <Tag color="default" bordered={false}>{detailViewRecord.manilaBayArea || "—"}</Tag>
                        )}</Descriptions.Item>
                      <Descriptions.Item label="District">{detailViewRecord.congressionalDistrict || "—"}</Descriptions.Item>
                      <Descriptions.Item label="Coordinates">{detailViewRecord.latitude}, {detailViewRecord.longitude}</Descriptions.Item>
                    </Descriptions>
                    <Descriptions column={2} size="small" bordered title="Equipment Details" style={{ marginTop: 16 }}>
                      <Descriptions.Item label="Equipment Type">{detailViewRecord.typeOfEquipment ? (
                          <Tag color="orange" bordered={false}>{detailViewRecord.typeOfEquipment}</Tag>
                        ) : "—"}</Descriptions.Item>
                      <Descriptions.Item label="Bio-Shredder">{getStatusTag(detailViewRecord.statusOfBioShredder)}</Descriptions.Item>
                      <Descriptions.Item label="Bio-Composter">{getStatusTag(detailViewRecord.statusOfBioComposter)}</Descriptions.Item>
                      <Descriptions.Item label="Soil Enhancer">{detailViewRecord.weightOfSoilEnhancer ? `${Number(detailViewRecord.weightOfSoilEnhancer).toLocaleString()} kg` : "—"}</Descriptions.Item>
                      <Descriptions.Item label="CCTV">{getStatusTag(detailViewRecord.statusOfCCTV)}</Descriptions.Item>
                      <Descriptions.Item label="Chair Factory">{getStatusTag(detailViewRecord.statusOfPlasticChairFactory)}</Descriptions.Item>
                      <Descriptions.Item label="Chairs Produced">{detailViewRecord.noPlasticChairProduced != null ? Number(detailViewRecord.noPlasticChairProduced).toLocaleString() : "—"}</Descriptions.Item>
                    </Descriptions>
                    <Descriptions column={3} size="small" bordered title="Personnel" style={{ marginTop: 16 }}>
                      <Descriptions.Item label="Focal Person">{detailViewRecord.focalPerson || "—"}</Descriptions.Item>
                      <Descriptions.Item label="ESWM Staff">{detailViewRecord.eswmStaff || "—"}</Descriptions.Item>
                      <Descriptions.Item label="ENMO Assigned">{detailViewRecord.enmoAssigned || "—"}</Descriptions.Item>
                    </Descriptions>
                  </>
                ),
              },
              {
                key: "monitoring",
                label: (
                  <>
                    <ClockCircleOutlined /> Monitoring
                  </>
                ),
                children: (
                  <>
                    <Descriptions column={2} size="small" bordered>
                      <Descriptions.Item label="Target Month">{detailViewRecord.targetMonth || "—"}</Descriptions.Item>
                      <Descriptions.Item label="IIS Number">{detailViewRecord.iisNumber || "—"}</Descriptions.Item>
                      <Descriptions.Item label="Date of Monitoring">{detailViewRecord.dateOfMonitoring ? dayjs(detailViewRecord.dateOfMonitoring).format("MM/DD/YYYY") : "—"}</Descriptions.Item>
                      <Descriptions.Item label="Report Prepared">{detailViewRecord.dateReportPrepared ? dayjs(detailViewRecord.dateReportPrepared).format("MM/DD/YYYY") : "—"}</Descriptions.Item>
                      <Descriptions.Item label="Reviewed (Staff)">{detailViewRecord.dateReportReviewedStaff ? dayjs(detailViewRecord.dateReportReviewedStaff).format("MM/DD/YYYY") : "—"}</Descriptions.Item>
                      <Descriptions.Item label="Reviewed (Focal)">{detailViewRecord.dateReportReviewedFocal ? dayjs(detailViewRecord.dateReportReviewedFocal).format("MM/DD/YYYY") : "—"}</Descriptions.Item>
                      <Descriptions.Item label="Report Approved">{detailViewRecord.dateReportApproved ? dayjs(detailViewRecord.dateReportApproved).format("MM/DD/YYYY") : "—"}</Descriptions.Item>
                    </Descriptions>
                    <Descriptions column={3} size="small" bordered style={{ marginTop: 16 }}>
                      <Descriptions.Item label="Days Prepared">{detailViewRecord.totalDaysReportPrepared ?? "—"}</Descriptions.Item>
                      <Descriptions.Item label="Days Staff Review">{detailViewRecord.totalDaysReviewedStaff ?? "—"}</Descriptions.Item>
                      <Descriptions.Item label="Days Focal Review">{detailViewRecord.totalDaysReviewedFocal ?? "—"}</Descriptions.Item>
                    </Descriptions>
                  </>
                ),
              },
              {
                key: "compliance",
                label: (
                  <>
                    <SafetyCertificateOutlined /> Compliance
                  </>
                ),
                children: (
                  <Descriptions column={2} size="small" bordered>
                    <Descriptions.Item label="Remarks" span={2}>{detailViewRecord.remarksNonOperating || "—"}</Descriptions.Item>
                    <Descriptions.Item label="Advise Letter">{detailViewRecord.adviseLetterIssued || "—"}</Descriptions.Item>
                    <Descriptions.Item label="Compliance">{detailViewRecord.complianceToAdvise || "—"}</Descriptions.Item>
                    <Descriptions.Item label="Signed Document">{detailViewRecord.signedDocument || "—"}</Descriptions.Item>
                  </Descriptions>
                ),
              },
            ]}
          />
          </>
        )}
      </Modal>

      {/* Add/Edit Modal */}
      <Modal
        title={editing ? "Edit SWM Equipment" : "Add SWM Equipment"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        width={900}
        style={{ maxWidth: "95vw" }}
        okText={editing ? "Update" : "Create"}
        okButtonProps={{
          style: { background: "#fa8c16", borderColor: "#fa8c16" },
        }}
      >
        <Form form={form} layout="vertical" size="small">
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={8}><Form.Item name="dataYear" label="Data Year" rules={[{ required: true }]}><Select options={Array.from({length:7},(_,i)=>{ const y=new Date().getFullYear()-i; return {label:y,value:y}; })} placeholder="Select Year" /></Form.Item></Col>
          </Row>
          <Collapse
            defaultActiveKey={["location","equipment","personnel","monitoring","compliance"]}
            bordered={false}
            items={[
              {
                key: "location",
                label: <span style={{ color: "#1677ff" }}><EnvironmentOutlined /> Location</span>,
                children: (
                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="province"
                        label="Province"
                        rules={[{ required: true }]}
                      >
                        <Select
                          options={provinceOptions}
                          placeholder="Select Province"
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="municipality"
                        label="Municipality"
                        rules={[{ required: true }]}
                      >
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="barangay" label="Barangay">
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="manilaBayArea" label="Manila Bay Area">
                        <Select
                          options={mbaOptions}
                          allowClear
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="congressionalDistrict"
                        label="Congressional District"
                      >
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={6}>
                      <Form.Item name="latitude" label="Latitude">
                        <InputNumber
                          style={{ width: "100%" }}
                          step={0.0001} precision={4}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={6}>
                      <Form.Item name="longitude" label="Longitude">
                        <InputNumber
                          style={{ width: "100%" }}
                          step={0.0001} precision={4}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "equipment",
                label: <span style={{ color: "#fa8c16" }}><ToolOutlined /> Equipment Details</span>,
                children: (
                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
                      <Form.Item name="typeOfEquipment" label="Equipment Type">
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="statusOfBioShredder"
                        label="Bio-Shredder Status"
                      >
                        <Select options={equipStatusOptions} allowClear placeholder="Select Status" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="statusOfBioComposter"
                        label="Bio-Composter Status"
                      >
                        <Select options={equipStatusOptions} allowClear placeholder="Select Status" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="weightOfSoilEnhancer"
                        label="Soil Enhancer (kg)"
                      >
                        <InputNumber style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="statusOfCCTV" label="CCTV Status">
                        <Select options={equipStatusOptions} allowClear placeholder="Select Status" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="statusOfPlasticChairFactory"
                        label="Chair Factory Status"
                      >
                        <Select options={equipStatusOptions} allowClear placeholder="Select Status" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="noPlasticChairProduced"
                        label="Chairs Produced"
                      >
                        <InputNumber style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "personnel",
                label: <span style={{ color: "#52c41a" }}><TeamOutlined /> Personnel</span>,
                children: (
                  <Row gutter={16}>
                    <Col xs={24} sm={8}>
                      <Form.Item name="enmoAssigned" label="ENMO Assigned">
                        <Select options={enmoOptions} allowClear showSearch placeholder="Select ENMO" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={8}>
                      <Form.Item name="eswmStaff" label="ESWM Staff">
                        <Select options={eswmStaffOptions} allowClear showSearch placeholder="Select Staff" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={8}>
                      <Form.Item name="focalPerson" label="Focal Person">
                        <Select options={focalOptions} allowClear showSearch placeholder="Select Focal" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="targetMonth" label="Target Month">
                        <Select
                          options={monthOptions}
                          allowClear
                          placeholder="Select"
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="iisNumber" label="IIS Number">
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "monitoring",
                label: <span style={{ color: "#13c2c2" }}><CalendarOutlined /> Monitoring</span>,
                children: (
                  <Row gutter={16}>
                    <Col xs={24} sm={8}>
                      <Form.Item
                        name="dateOfMonitoring"
                        label="Date of Monitoring"
                      >
                        <DatePicker format="MM/DD/YYYY" style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={8}>
                      <Form.Item
                        name="dateReportPrepared"
                        label="Report Prepared"
                      >
                        <DatePicker format="MM/DD/YYYY" style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={8}>
                      <Form.Item
                        name="dateReportReviewedStaff"
                        label="Reviewed (Staff)"
                      >
                        <DatePicker format="MM/DD/YYYY" style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={8}>
                      <Form.Item
                        name="dateReportReviewedFocal"
                        label="Reviewed (Focal)"
                      >
                        <DatePicker format="MM/DD/YYYY" style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={8}>
                      <Form.Item
                        name="dateReportApproved"
                        label="Report Approved"
                      >
                        <DatePicker format="MM/DD/YYYY" style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "compliance",
                label: <span style={{ color: "#eb2f96" }}><SafetyCertificateOutlined /> Compliance</span>,
                children: (
                  <Row gutter={16}>
                    <Col span={24}>
                      <Form.Item
                        name="remarksNonOperating"
                        label="Remarks (Non-Operating)"
                      >
                        <Input.TextArea rows={2} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="adviseLetterIssued"
                        label="Advise Letter Issued"
                      >
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="complianceToAdvise" label="Compliance">
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="signedDocument" label="Signed Document">
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
            ]}
          />
        </Form>
      </Modal>
    </div>
  );
}
