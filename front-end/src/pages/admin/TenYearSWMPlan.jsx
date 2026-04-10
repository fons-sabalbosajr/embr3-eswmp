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
  Descriptions,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  FundProjectionScreenOutlined,
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
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import secureStorage from "../../utils/secureStorage";
import { useDataRef } from "../../utils/dataRef";
import dayjs from "dayjs";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix default Leaflet marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const { Title, Text } = Typography;

const CACHE_KEY = "ten-year-swm-cache";
const CACHE_TTL = 5 * 60 * 1000;

function buildFilters(records, key) {
  const vals = [...new Set(records.map((r) => r[key]).filter(Boolean))].sort();
  return vals.map((v) => ({ text: v, value: v }));
}

// Replicate Excel NETWORKDAYS (weekdays only, no holiday list)
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
  // Excel formula: NETWORKDAYS - 1 (if start != end), min 1
  return Math.max(1, count > 1 ? count - 1 : count);
}

// Compute derived fields matching Excel formulas
function computeFields(rec) {
  const computed = {};
  // Processing days (NETWORKDAYS between date pairs)
  computed.totalDaysReportPrepared = networkDays(
    rec.dateOfMonitoring,
    rec.dateReportPrepared,
  );
  computed.totalDaysReviewedStaff = networkDays(
    rec.dateReportPrepared,
    rec.dateReportReviewedStaff,
  );
  computed.totalDaysReviewedFocal = networkDays(
    rec.dateReportReviewedStaff || rec.dateReportPrepared,
    rec.dateReportReviewedFocal,
  );
  computed.totalDaysApproved = networkDays(
    rec.dateReportReviewedFocal,
    rec.dateReportApproved,
  );
  // Waste Diversion Rate = Bio% + Recyclable% + Residual_Potential%
  const bio = rec.biodegradablePercent || 0;
  const recy = rec.recyclablePercent || 0;
  const resPot = rec.residualWithPotentialPercent || 0;
  const resDisp = rec.residualPercent || 0;
  const spec = rec.specialPercent || 0;
  if (bio || recy || resPot)
    computed.wasteDiversionRateCalc = bio + recy + resPot;
  if (resDisp || spec) computed.disposalRate = resDisp + spec;
  return computed;
}

export default function TenYearSWMPlan() {
  const { getValues } = useDataRef();
  const provinceOptions = getValues("province").map((p) => ({
    label: p,
    value: p,
  }));
  const monthOptions = getValues("target-month").map((m) => ({
    label: m.replace(/^\d+\./, ""),
    value: m,
  }));
  const mbaOptions = getValues("manila-bay-area").map((v) => ({
    label: v,
    value: v,
  }));
  const yesNoOptions = getValues("yes-no").map((v) => ({ label: v, value: v }));
  const planStatusOptions = getValues("swm-plan-status").map((v) => ({
    label: v,
    value: v,
  }));
  const planComplianceOptions = getValues("swm-plan-compliance").map((v) => ({
    label: v,
    value: v,
  }));
  const typeOfPlanOptions = getValues("type-of-plan").map((v) => ({
    label: v,
    value: v,
  }));
  const enmoOptions = getValues("enmo").map((v) => ({ label: v, value: v }));
  const eswmStaffOptions = getValues("eswm-staff").map((v) => ({
    label: v,
    value: v,
  }));
  const focalOptions = getValues("eswm-focal").map((v) => ({
    label: v,
    value: v,
  }));

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
  const [filterCompliance, setFilterCompliance] = useState(null);
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
      const { data } = await api.get("/ten-year-swm");
      const enriched = data.map((r) => ({ ...r, ...computeFields(r) }));
      setRecords(enriched);
      secureStorage.setJSON(CACHE_KEY, { data, ts: Date.now() });
    } catch {
      Swal.fire("Error", "Failed to load records", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // Fetch cross-year history when viewing a record
  useEffect(() => {
    if (!detailModal) {
      setDetailYearRecords([]);
      setDetailYear(null);
      return;
    }
    const name = detailModal.municipality;
    if (!name) return;
    api
      .get(`/ten-year-swm/history/${encodeURIComponent(name)}`)
      .then(({ data }) => {
        const enriched = data.map((r) => ({ ...r, ...computeFields(r) }));
        setDetailYearRecords(enriched);
        // Default to the year of the record that was clicked
        setDetailYear(detailModal.dataYear || new Date().getFullYear());
      })
      .catch(() => {
        setDetailYearRecords([]);
        setDetailYear(detailModal.dataYear || new Date().getFullYear());
      });
  }, [detailModal]);

  // The record for the currently selected year tab
  const detailViewRecord = useMemo(() => {
    if (!detailModal) return null;
    if (detailYearRecords.length === 0) return detailModal;
    return (
      detailYearRecords.find((r) => (r.dataYear || new Date().getFullYear()) === detailYear) ||
      detailModal
    );
  }, [detailModal, detailYearRecords, detailYear]);

  const openAdd = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

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
      // Compute derived fields from Excel formulas
      const derived = computeFields(payload);
      Object.assign(payload, derived);
      if (editing) {
        const { data } = await api.put(`/ten-year-swm/${editing._id}`, payload);
        setRecords((prev) =>
          prev.map((r) =>
            r._id === editing._id ? { ...data, ...computeFields(data) } : r,
          ),
        );
        secureStorage.remove(CACHE_KEY);
        secureStorage.invalidateDashboard();
        Swal.fire("Updated", "Record updated successfully", "success");
      } else {
        await api.post("/ten-year-swm", payload);
        secureStorage.remove(CACHE_KEY);
        secureStorage.invalidateDashboard();
        Swal.fire("Created", "Record added successfully", "success");
        fetchRecords();
      }
    } catch (err) {
      if (err.response) {
        Swal.fire(
          "Error",
          err.response.data?.message || "Save failed",
          "error",
        );
      }
    }
  };

  const getComplianceTag = (val) => {
    if (!val) return <Tag color="default">—</Tag>;
    if (/non.?compliant/i.test(val))
      return (
        <Tag color="red" icon={<CloseCircleOutlined />}>
          Non-Compliant
        </Tag>
      );
    if (/compliant/i.test(val))
      return (
        <Tag color="green" icon={<CheckCircleOutlined />}>
          Compliant
        </Tag>
      );
    return <Tag color="default">{val}</Tag>;
  };

  const getRenewalTag = (val) => {
    if (!val) return <Tag color="default">—</Tag>;
    if (/approved/i.test(val))
      return (
        <Tag color="success" bordered={false}>
          Approved
        </Tag>
      );
    if (/renewal/i.test(val))
      return (
        <Tag color="warning" bordered={false}>
          For Renewal
        </Tag>
      );
    return (
      <Tag color="processing" bordered={false}>
        {val}
      </Tag>
    );
  };

  const filters = useMemo(
    () => ({
      province: buildFilters(records, "province"),
      municipality: buildFilters(records, "municipality"),
      manilaBayArea: buildFilters(records, "manilaBayArea"),
      typeOfSWMPlan: buildFilters(records, "typeOfSWMPlan"),
      periodCovered: buildFilters(records, "periodCovered"),
      forRenewal: buildFilters(records, "forRenewal"),
      remarksAndRecommendation: buildFilters(
        records,
        "remarksAndRecommendation",
      ),
      enmoAssigned: buildFilters(records, "enmoAssigned"),
      eswmStaff: buildFilters(records, "eswmStaff"),
      focalPerson: buildFilters(records, "focalPerson"),
      targetMonth: buildFilters(records, "targetMonth").map((f) => ({
        ...f,
        text: f.text.replace(/^\d+\./, ""),
      })),
      congressionalDistrict: buildFilters(records, "congressionalDistrict"),
      lguFinalDisposal: buildFilters(records, "lguFinalDisposal"),
    }),
    [records],
  );

  const filtered = useMemo(
    () =>
      records.filter((r) => {
        if (searchText) {
          const s = searchText.toLowerCase();
          const match = [
            r.province,
            r.municipality,
            r.enmoAssigned,
            r.eswmStaff,
            r.iisNumber,
            r.resolutionNo,
            r.focalPerson,
            r.lguFinalDisposal,
          ]
            .filter(Boolean)
            .some((v) => v.toLowerCase().includes(s));
          if (!match) return false;
        }
        if (filterProvince && r.province !== filterProvince) return false;
        if (filterMBA && r.manilaBayArea !== filterMBA) return false;
        if (filterCompliance) {
          if (
            filterCompliance === "Compliant" &&
            !/^compliant$/i.test(r.remarksAndRecommendation)
          )
            return false;
          if (
            filterCompliance === "Non-Compliant" &&
            !/non.?compliant/i.test(r.remarksAndRecommendation)
          )
            return false;
        }
        if (filterStatus && r.forRenewal !== filterStatus) return false;
        if (filterMonth && r.targetMonth !== filterMonth) return false;
        return true;
      }),
    [
      records,
      searchText,
      filterProvince,
      filterMBA,
      filterCompliance,
      filterStatus,
      filterMonth,
    ],
  );

  const hasActiveFilters =
    filterProvince ||
    filterMBA ||
    filterCompliance ||
    filterStatus ||
    filterMonth ||
    searchText;

  const clearAllFilters = () => {
    setSearchText("");
    setFilterProvince(null);
    setFilterMBA(null);
    setFilterCompliance(null);
    setFilterStatus(null);
    setFilterMonth(null);
  };

  const columns = [
    {
      title: "Year",
      dataIndex: "dataYear",
      key: "dataYear",
      width: 90,
      fixed: "left",
      filters: Array.from({ length: 7 }, (_, i) => {
        const y = new Date().getFullYear() - i;
        return { text: String(y), value: y };
      }),
      onFilter: (v, r) => (r.dataYear || new Date().getFullYear()) === v,
      defaultFilteredValue: [new Date().getFullYear()],
      sorter: (a, b) => (a.dataYear || new Date().getFullYear()) - (b.dataYear || new Date().getFullYear()),
      render: (v) => {
        const currYear = new Date().getFullYear();
        return (
          <Tag bordered={false} color={v === currYear ? "blue" : v === currYear - 1 ? "orange" : "default"}>
            {v || currYear}
          </Tag>
        );
      },
    },
    {
      title: (
        <>
          <EnvironmentOutlined style={{ color: "#1a3353" }} /> LGU
        </>
      ),
      key: "lgu",
      width: 130,
      fixed: "left",
      filters: filters.province,
      onFilter: (v, r) => r.province === v,
      sorter: (a, b) =>
        (a.municipality || "").localeCompare(b.municipality || ""),
      render: (_, r) => (
        <Tooltip
          title={`${r.province} — ${r.municipality}${r.congressionalDistrict ? ` (${r.congressionalDistrict} District)` : ""}`}
        >
          <div style={{ lineHeight: 1.3 }}>
            <Text strong style={{ fontSize: 12 }}>
              {r.municipality}
            </Text>
            <br />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {r.province}
              {r.congressionalDistrict ? ` · ${r.congressionalDistrict}` : ""}
            </Text>
          </div>
        </Tooltip>
      ),
    },
    {
      title: "MBA",
      dataIndex: "manilaBayArea",
      key: "mba",
      width: 90,
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
        <>
          <AuditOutlined style={{ color: "#2f54eb" }} /> Plan / Resolution
        </>
      ),
      key: "planResolution",
      width: 150,
      filters: filters.typeOfSWMPlan,
      onFilter: (v, r) => r.typeOfSWMPlan === v,
      render: (_, r) => (
        <Tooltip title={r.resolutionNo || "No resolution"}>
          <div style={{ lineHeight: 1.3 }}>
            {r.typeOfSWMPlan ? (
              <Tag
                color="geekblue"
                bordered={false}
                style={{ marginBottom: 2 }}
              >
                {r.typeOfSWMPlan}
              </Tag>
            ) : (
              <Text type="secondary" style={{ fontSize: 11 }}>
                —
              </Text>
            )}
            <br />
            <Text type="secondary" style={{ fontSize: 10 }} ellipsis>
              {r.resolutionNo || "—"}
            </Text>
          </div>
        </Tooltip>
      ),
    },
    {
      title: (
        <>
          <CalendarOutlined style={{ color: "#13c2c2" }} /> Coverage
        </>
      ),
      key: "coverage",
      width: 120,
      filters: filters.periodCovered,
      filterSearch: true,
      onFilter: (v, r) => r.periodCovered === v,
      sorter: (a, b) => (a.yearApproved || 0) - (b.yearApproved || 0),
      render: (_, r) => (
        <Tooltip
          title={`Approved: ${r.yearApproved || "—"} · End: ${r.endPeriod || "—"}`}
        >
          <div style={{ lineHeight: 1.3 }}>
            <Tag bordered={false}>{r.periodCovered || "—"}</Tag>
            <br />
            <Text type="secondary" style={{ fontSize: 10 }}>
              Yr. {r.yearApproved || "—"}
            </Text>
          </div>
        </Tooltip>
      ),
    },
    {
      title: "Status",
      dataIndex: "forRenewal",
      key: "status",
      width: 100,
      filters: filters.forRenewal,
      onFilter: (v, r) => r.forRenewal === v,
      render: (v) => getRenewalTag(v),
    },
    {
      title: (
        <>
          <TeamOutlined style={{ color: "#722ed1" }} /> Personnel
        </>
      ),
      key: "personnel",
      width: 190,
      filters: filters.focalPerson,
      filterSearch: true,
      onFilter: (v, r) => r.focalPerson === v,
      render: (_, r) => (
        <Tooltip
          title={
            <div>
              <div>
                <UserOutlined /> Focal: {r.focalPerson || "—"}
              </div>
              <div>
                <UserOutlined /> Staff: {r.eswmStaff || "—"}
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
              <UserOutlined style={{ marginRight: 3 }} />
              {r.eswmStaff || "—"}
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
      title: "Target Month",
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
      title: "LGU Disposal",
      dataIndex: "lguFinalDisposal",
      key: "lguFinalDisposal",
      width: 160,
      ellipsis: { showTitle: false },
      filters: filters.lguFinalDisposal,
      filterSearch: true,
      onFilter: (v, r) => r.lguFinalDisposal === v,
      render: (v) => (
        <Tooltip title={v}>
          <Text style={{ fontSize: 11 }}>{v || "—"}</Text>
        </Tooltip>
      ),
    },
    {
      title: "Diversion Rate",
      dataIndex: "wasteDiversionRateCalc",
      key: "diversionRate",
      width: 130,
      sorter: (a, b) =>
        (a.wasteDiversionRateCalc || 0) - (b.wasteDiversionRateCalc || 0),
      render: (v, r) => {
        const pct =
          v != null
            ? Math.round(v * 100)
            : r.wasteDiversionRate != null
              ? Math.round(
                  r.wasteDiversionRate * (r.wasteDiversionRate > 1 ? 1 : 100),
                )
              : null;
        if (pct == null) return <Tag color="default">—</Tag>;
        return (
          <Tooltip title={`${pct.toFixed ? pct.toFixed(1) : pct}%`}>
            <Progress
              percent={pct}
              size="small"
              strokeColor={
                pct >= 50 ? "#52c41a" : pct >= 25 ? "#faad14" : "#ff4d4f"
              }
              format={() => `${pct}%`}
              style={{ width: 100 }}
            />
          </Tooltip>
        );
      },
    },
    {
      title: "Compliance",
      dataIndex: "remarksAndRecommendation",
      key: "compliance",
      width: 120,
      filters: filters.remarksAndRecommendation,
      onFilter: (v, r) => r.remarksAndRecommendation === v,
      render: (v) => getComplianceTag(v),
    },
    {
      title: "Actions",
      key: "actions",
      width: 80,
      fixed: "right",
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title="View Details">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined style={{ color: "#1890ff" }} />}
              onClick={() => setDetailModal(record)}
            />
          </Tooltip>
          <Tooltip title="Edit">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined style={{ color: "#52c41a" }} />}
              onClick={() => openEdit(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  // Summary stats — computed from filtered data
  const totalCompliant = filtered.filter(
    (r) =>
      /compliant/i.test(r.remarksAndRecommendation) &&
      !/non/i.test(r.remarksAndRecommendation),
  ).length;
  const totalNonCompliant = filtered.filter((r) =>
    /non.?compliant/i.test(r.remarksAndRecommendation),
  ).length;
  const avgDiversion =
    filtered.length > 0
      ? filtered.reduce((sum, r) => sum + (r.wasteDiversionRate || 0), 0) /
        filtered.length
      : 0;
  const normalizedAvgDiversion =
    avgDiversion > 1 ? avgDiversion : avgDiversion * 100;
  const mbaCount = filtered.filter((r) => r.manilaBayArea === "MBA").length;
  const approvedCount = filtered.filter((r) =>
    /approved/i.test(r.forRenewal),
  ).length;
  const forRenewalCount = filtered.filter((r) =>
    /renewal/i.test(r.forRenewal),
  ).length;
  const complianceRate =
    filtered.length > 0 ? (totalCompliant / filtered.length) * 100 : 0;
  const provinceCount = new Set(filtered.map((r) => r.province).filter(Boolean))
    .size;

  return (
    <div>
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        @keyframes subtleBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        .swm-card { animation: fadeInUp 0.5s ease-out both; }
        .swm-tag-pulse { animation: pulse 2.5s ease-in-out infinite; }
        .swm-icon-bounce { display: inline-block; transition: transform 0.2s; cursor: default; }
        .swm-icon-bounce:hover { animation: subtleBounce 0.4s ease; }
        .ant-tag { transition: all 0.3s ease; }
        .ant-tag:hover { transform: scale(1.05); }
        .ant-table-row { transition: background-color 0.2s ease; }
      `}</style>
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
          <FundProjectionScreenOutlined /> 10-Year SWM Plan
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
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
            Add Record
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={() => {
              const rows = filtered.map((r) => ({
                Province: r.province,
                Municipality: r.municipality,
                "Manila Bay Area": r.manilaBayArea,
                "Congressional District": r.congressionalDistrict,
                "Type of SWM Plan": r.typeOfSWMPlan,
                "Resolution No.": r.resolutionNo,
                "Period Covered": r.periodCovered,
                "Year Approved": r.yearApproved,
                "End Period": r.endPeriod,
                Status: r.forRenewal,
                "ENMO Assigned": r.enmoAssigned,
                "ESWM Staff": r.eswmStaff,
                "Focal Person": r.focalPerson,
                "Target Month": r.targetMonth,
                "IIS Number": r.iisNumber,
                "Date of Monitoring": r.dateOfMonitoring
                  ? dayjs(r.dateOfMonitoring).format("MMM DD, YYYY")
                  : "",
                "Waste Diversion Rate (%)": r.wasteDiversionRate,
                "Total Waste Generation": r.totalWasteGeneration,
                Compliance: r.remarksAndRecommendation,
                "LGU Final Disposal": r.lguFinalDisposal,
              }));
              exportToExcel(rows, "10_Year_SWM_Plan");
            }}
          >
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
            <FilterOutlined style={{ color: "#1890ff", marginRight: 6 }} />
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
                style={{ width: "100%", minWidth: 100, maxWidth: 160 }}
                size="small"
                options={provinceOptions}
                suffixIcon={<EnvironmentOutlined />}
              />
              <Select
                placeholder="MBA"
                value={filterMBA}
                onChange={setFilterMBA}
                allowClear
                style={{ width: "100%", minWidth: 100, maxWidth: 150 }}
                size="small"
                options={mbaOptions}
              />
              <Select
                placeholder="Status"
                value={filterStatus}
                onChange={setFilterStatus}
                allowClear
                style={{ width: "100%", minWidth: 100, maxWidth: 150 }}
                size="small"
                options={planStatusOptions}
                suffixIcon={<AuditOutlined />}
              />
              <Select
                placeholder="Compliance"
                value={filterCompliance}
                onChange={setFilterCompliance}
                allowClear
                style={{ width: "100%", minWidth: 100, maxWidth: 160 }}
                size="small"
                options={planComplianceOptions}
                suffixIcon={<SafetyCertificateOutlined />}
              />
              <Select
                placeholder="Target Month"
                value={filterMonth}
                onChange={setFilterMonth}
                allowClear
                style={{ width: "100%", minWidth: 100, maxWidth: 160 }}
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
            className="swm-card"
            style={{
              borderRadius: 10,
              borderLeft: "3px solid #1a3353",
              height: "100%",
            }}
          >
            <Statistic
              title="Total LGUs"
              value={filtered.length}
              prefix={
                <EnvironmentOutlined
                  className="swm-icon-bounce"
                  style={{ color: "#1a3353" }}
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
            className="swm-card"
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
                title="Compliance Rate"
                value={complianceRate.toFixed(1)}
                suffix="%"
                prefix={
                  <SafetyCertificateOutlined
                    className="swm-icon-bounce"
                    style={{ color: "#52c41a" }}
                  />
                }
              />
              <Progress
                type="circle"
                percent={Math.round(complianceRate)}
                size={48}
                strokeColor={{ "0%": "#52c41a", "100%": "#87d068" }}
              />
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
              <Tag color="green" bordered={false} className="swm-tag-pulse">
                <CheckCircleOutlined /> {totalCompliant}
              </Tag>
              <Tag color="red" bordered={false} className="swm-tag-pulse">
                <CloseCircleOutlined /> {totalNonCompliant}
              </Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card
            size="small"
            hoverable
            className="swm-card"
            style={{
              borderRadius: 10,
              borderLeft: "3px solid #1890ff",
              height: "100%",
              animationDelay: "0.14s",
            }}
          >
            <Statistic
              title="Avg. Diversion Rate"
              value={normalizedAvgDiversion.toFixed(1)}
              suffix="%"
              prefix={
                <BarChartOutlined
                  className="swm-icon-bounce"
                  style={{ color: "#1890ff" }}
                />
              }
            />
            <Progress
              percent={Math.round(normalizedAvgDiversion)}
              size="small"
              strokeColor={
                normalizedAvgDiversion >= 50
                  ? "#52c41a"
                  : normalizedAvgDiversion >= 25
                    ? "#faad14"
                    : "#ff4d4f"
              }
              style={{ marginTop: 8 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card
            size="small"
            hoverable
            className="swm-card"
            style={{
              borderRadius: 10,
              borderLeft: "3px solid #faad14",
              height: "100%",
              animationDelay: "0.21s",
            }}
          >
            <Statistic
              title="Plan Status"
              value={approvedCount}
              prefix={
                <AuditOutlined
                  className="swm-icon-bounce"
                  style={{ color: "#faad14" }}
                />
              }
              suffix={
                <Text type="secondary" style={{ fontSize: 14 }}>
                  / {filtered.length}
                </Text>
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
              <Tag color="success" bordered={false}>
                Approved {approvedCount}
              </Tag>
              <Tag color="warning" bordered={false}>
                Renewal {forRenewalCount}
              </Tag>
            </div>
          </Card>
        </Col>
      </Row>

      <Card style={{ borderRadius: 10 }}>
        <Table
          dataSource={filtered}
          columns={columns}
          rowKey="_id"
          loading={loading}
          scroll={{ x: 1460 }}
          pagination={{
            defaultPageSize: 15,
            pageSizeOptions: ["10", "15", "20", "50", "100"],
            showSizeChanger: true,
            showTotal: (t, r) => `${r[0]}-${r[1]} of ${t} records`,
          }}
          size="small"
        />
      </Card>

      {/* Detail View Modal */}
      <Modal
        title={
          <Space>
            <FileTextOutlined />
            {detailModal?.municipality}, {detailModal?.province}
            {detailYearRecords.length >= 1 && (
              <Tag color="blue" bordered={false} style={{ marginLeft: 8 }}>
                {detailYearRecords.length} year records
              </Tag>
            )}
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
            {/* Year selector tabs */}
            {detailYearRecords.length >= 1 && (
              <div style={{ marginBottom: 12 }}>
                <Space size={8}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Data Year:
                  </Text>
                  {detailYearRecords
                    .map((r) => r.dataYear || new Date().getFullYear())
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .sort((a, b) => b - a)
                    .map((yr) => (
                      <Button
                        key={yr}
                        size="small"
                        type={detailYear === yr ? "primary" : "default"}
                        onClick={() => setDetailYear(yr)}
                      >
                        {yr}
                      </Button>
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
                        <Descriptions.Item label="Province">
                          <Text strong>{detailViewRecord.province}</Text>
                        </Descriptions.Item>
                        <Descriptions.Item label="Municipality">
                          <Text strong>{detailViewRecord.municipality}</Text>
                        </Descriptions.Item>
                        <Descriptions.Item label="Manila Bay Area">
                          {detailViewRecord.manilaBayArea === "MBA" ? (
                            <Tag color="blue" bordered={false}>
                              MBA
                            </Tag>
                          ) : (
                            <Tag color="default" bordered={false}>
                              {detailViewRecord.manilaBayArea || "—"}
                            </Tag>
                          )}
                        </Descriptions.Item>
                        <Descriptions.Item label="Congressional District">
                          {detailViewRecord.congressionalDistrict || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Coordinates">
                          {detailViewRecord.latitude},{" "}
                          {detailViewRecord.longitude}
                        </Descriptions.Item>
                      </Descriptions>
                      <Descriptions column={2} size="small" bordered title="Plan Details" style={{ marginTop: 16 }}>
                        <Descriptions.Item label="Plan Type">
                          {detailViewRecord.typeOfSWMPlan ? (
                            <Tag color="geekblue" bordered={false}>
                              {detailViewRecord.typeOfSWMPlan}
                            </Tag>
                          ) : (
                            "—"
                          )}
                        </Descriptions.Item>
                        <Descriptions.Item label="Resolution No.">
                          {detailViewRecord.resolutionNo || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Period Covered">
                          <Tag bordered={false}>
                            {detailViewRecord.periodCovered || "—"}
                          </Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="Year Approved">
                          {detailViewRecord.yearApproved || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="End Period">
                          {detailViewRecord.endPeriod || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Status">
                          {getRenewalTag(detailViewRecord.forRenewal)}
                        </Descriptions.Item>
                      </Descriptions>
                      <Descriptions column={3} size="small" bordered title="Personnel" style={{ marginTop: 16 }}>
                        <Descriptions.Item label="Focal Person">
                          <Text strong>
                            {detailViewRecord.focalPerson || "—"}
                          </Text>
                        </Descriptions.Item>
                        <Descriptions.Item label="ESWM Staff">
                          <Text strong>
                            {detailViewRecord.eswmStaff || "—"}
                          </Text>
                        </Descriptions.Item>
                        <Descriptions.Item label="ENMO Assigned">
                          <Text strong>
                            {detailViewRecord.enmoAssigned || "—"}
                          </Text>
                        </Descriptions.Item>
                      </Descriptions>
                      {detailViewRecord.latitude &&
                        detailViewRecord.longitude && (
                          <>
                            <Divider plain orientation="left">
                              <GlobalOutlined /> Location Map
                            </Divider>
                            <div
                              style={{
                                height: 220,
                                borderRadius: 8,
                                overflow: "hidden",
                              }}
                            >
                              <MapContainer
                                center={[
                                  Number(detailViewRecord.latitude),
                                  Number(detailViewRecord.longitude),
                                ]}
                                zoom={12}
                                style={{
                                  height: "100%",
                                  width: "100%",
                                  borderRadius: 8,
                                }}
                                scrollWheelZoom={true}
                              >
                                <TileLayer
                                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                />
                                <Marker
                                  position={[
                                    Number(detailViewRecord.latitude),
                                    Number(detailViewRecord.longitude),
                                  ]}
                                >
                                  <Popup>
                                    <Text strong>
                                      {detailViewRecord.municipality}
                                    </Text>
                                    <br />
                                    <Text type="secondary">
                                      {detailViewRecord.province}
                                    </Text>
                                    <br />
                                    <Text style={{ fontSize: 11 }}>
                                      {detailViewRecord.latitude},{" "}
                                      {detailViewRecord.longitude}
                                    </Text>
                                  </Popup>
                                </Marker>
                              </MapContainer>
                            </div>
                          </>
                        )}
                    </>
                  ),
                },
                {
                  key: "monitoring",
                  label: (
                    <>
                      <CalendarOutlined /> Monitoring
                    </>
                  ),
                  children: (
                    <>
                      <Descriptions column={2} size="small" bordered>
                        <Descriptions.Item label="Target Month">
                          {detailViewRecord.targetMonth ? (
                            <Tag color="cyan" bordered={false}>
                              {detailViewRecord.targetMonth.replace(
                                /^\d+\./,
                                "",
                              )}
                            </Tag>
                          ) : (
                            "—"
                          )}
                        </Descriptions.Item>
                        <Descriptions.Item label="IIS Number">
                          {detailViewRecord.iisNumber || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Date of Monitoring">
                          {detailViewRecord.dateOfMonitoring
                            ? dayjs(detailViewRecord.dateOfMonitoring).format(
                                "MMM DD, YYYY",
                              )
                            : "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Report Prepared">
                          {detailViewRecord.dateReportPrepared
                            ? dayjs(
                                detailViewRecord.dateReportPrepared,
                              ).format("MMM DD, YYYY")
                            : "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Reviewed (Staff)">
                          {detailViewRecord.dateReportReviewedStaff
                            ? dayjs(
                                detailViewRecord.dateReportReviewedStaff,
                              ).format("MMM DD, YYYY")
                            : "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Reviewed (Focal)">
                          {detailViewRecord.dateReportReviewedFocal
                            ? dayjs(
                                detailViewRecord.dateReportReviewedFocal,
                              ).format("MMM DD, YYYY")
                            : "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Report Approved">
                          {detailViewRecord.dateReportApproved
                            ? dayjs(
                                detailViewRecord.dateReportApproved,
                              ).format("MMM DD, YYYY")
                            : "—"}
                        </Descriptions.Item>
                      </Descriptions>
                      <Divider plain>
                        <CalendarOutlined /> Processing Days
                      </Divider>
                      <Row gutter={[16, 8]}>
                        <Col xs={12} sm={6}>
                          <Statistic
                            title="Prepared"
                            value={
                              detailViewRecord.totalDaysReportPrepared ?? "—"
                            }
                            suffix="days"
                          />
                        </Col>
                        <Col xs={12} sm={6}>
                          <Statistic
                            title="Staff Review"
                            value={
                              detailViewRecord.totalDaysReviewedStaff ?? "—"
                            }
                            suffix="days"
                          />
                        </Col>
                        <Col xs={12} sm={6}>
                          <Statistic
                            title="Focal Review"
                            value={
                              detailViewRecord.totalDaysReviewedFocal ?? "—"
                            }
                            suffix="days"
                          />
                        </Col>
                        <Col xs={12} sm={6}>
                          <Statistic
                            title="Approved"
                            value={detailViewRecord.totalDaysApproved ?? "—"}
                            suffix="days"
                          />
                        </Col>
                      </Row>
                    </>
                  ),
                },
                {
                  key: "compliance",
                  label: "Compliance",
                  children: (
                    <>
                      <Descriptions column={2} size="small" bordered>
                        <Descriptions.Item label="Overall Compliance" span={2}>
                          {getComplianceTag(
                            detailViewRecord.remarksAndRecommendation,
                          )}
                        </Descriptions.Item>
                      </Descriptions>
                      <Divider plain>ESWM Components</Divider>
                      <Row gutter={[16, 12]}>
                        {[
                          {
                            label: "Source Reduction",
                            val: detailViewRecord.sourceReduction,
                          },
                          {
                            label: "Segregated Collection",
                            val: detailViewRecord.segregatedCollection,
                          },
                          {
                            label: "Storage & Setout",
                            val: detailViewRecord.storageAndSetout,
                          },
                          {
                            label: "Processing MRF",
                            val: detailViewRecord.processingMRF,
                          },
                          {
                            label: "Transfer Station",
                            val: detailViewRecord.transferStation,
                          },
                          {
                            label: "Disposal Facilities",
                            val: detailViewRecord.disposalFacilities,
                          },
                        ].map((item) => (
                          <Col xs={12} sm={8} key={item.label}>
                            <Badge
                              status={
                                item.val === "YES"
                                  ? "success"
                                  : item.val === "NO"
                                    ? "error"
                                    : "default"
                              }
                              text={
                                <Text>
                                  {item.label}:{" "}
                                  <Text strong>{item.val || "—"}</Text>
                                </Text>
                              }
                            />
                          </Col>
                        ))}
                      </Row>
                      <Descriptions column={2} size="small" bordered title="LGU Disposal & Advise" style={{ marginTop: 16 }}>
                        <Descriptions.Item label="LGU Final Disposal">
                          {detailViewRecord.lguFinalDisposal || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Advise Letter Date">
                          {detailViewRecord.adviseLetterDateIssued || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Compliance to Advise">
                          {detailViewRecord.complianceToAdvise || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Remarks">
                          {detailViewRecord.remarks || "—"}
                        </Descriptions.Item>
                      </Descriptions>
                    </>
                  ),
                },
                {
                  key: "waste",
                  label: (
                    <>
                      <FundProjectionScreenOutlined /> Waste Data
                    </>
                  ),
                  children: (
                    <>
                      <Row gutter={[16, 8]}>
                        <Col xs={24} sm={12}>
                          <Statistic
                            title="Total Waste Generation"
                            value={
                              detailViewRecord.totalWasteGeneration?.toLocaleString() ||
                              "—"
                            }
                            suffix="kg/day"
                          />
                        </Col>
                        <Col xs={24} sm={12}>
                          <Statistic
                            title="PCG"
                            value={detailViewRecord.pcg || "—"}
                          />
                        </Col>
                      </Row>
                      <Divider plain>Waste Composition</Divider>
                      {[
                        {
                          label: "Biodegradable",
                          val: detailViewRecord.biodegradableWaste,
                          pct: detailViewRecord.biodegradablePercent,
                          color: "#52c41a",
                        },
                        {
                          label: "Recyclable",
                          val: detailViewRecord.recyclableWaste,
                          pct: detailViewRecord.recyclablePercent,
                          color: "#1890ff",
                        },
                        {
                          label: "Residual (Potential)",
                          val: detailViewRecord.residualWithPotential,
                          pct: detailViewRecord.residualWithPotentialPercent,
                          color: "#faad14",
                        },
                        {
                          label: "Residual (Disposal)",
                          val: detailViewRecord.residualWasteForDisposal,
                          pct: detailViewRecord.residualPercent,
                          color: "#ff4d4f",
                        },
                        {
                          label: "Special Waste",
                          val: detailViewRecord.specialWaste,
                          pct: detailViewRecord.specialPercent,
                          color: "#722ed1",
                        },
                      ].map((w) => (
                        <div key={w.label} style={{ marginBottom: 12 }}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 4,
                            }}
                          >
                            <Text>{w.label}</Text>
                            <Text strong>
                              {w.val?.toLocaleString() || 0} kg/day (
                              {((w.pct || 0) * 100).toFixed(1)}%)
                            </Text>
                          </div>
                          <Progress
                            percent={Math.round((w.pct || 0) * 100)}
                            strokeColor={w.color}
                            showInfo={false}
                            size="small"
                          />
                        </div>
                      ))}
                      <Divider />
                      <Row gutter={[16, 16]}>
                        <Col xs={24} sm={12}>
                          <Statistic
                            title="Waste Diversion Rate"
                            value={(
                              (detailViewRecord.wasteDiversionRateCalc ||
                                detailViewRecord.wasteDiversionRate ||
                                0) * 100
                            ).toFixed(1)}
                            suffix="%"
                            styles={{ content: { color: "#52c41a" } }}
                          />
                        </Col>
                        <Col xs={24} sm={12}>
                          <Statistic
                            title="Disposal Rate"
                            value={(
                              (detailViewRecord.disposalRate || 0) * 100
                            ).toFixed(1)}
                            suffix="%"
                            styles={{ content: { color: "#ff4d4f" } }}
                          />
                        </Col>
                      </Row>
                      {detailViewRecord.signedDocument && (
                        <>
                          <Divider />
                          <Button
                            type="link"
                            icon={<LinkOutlined />}
                            href={detailViewRecord.signedDocument}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View Signed Document
                          </Button>
                        </>
                      )}
                    </>
                  ),
                },
              ]}
            />
          </>
        )}
      </Modal>

      {/* Add / Edit Modal — Tab Panes */}
      <Modal
        title={
          editing
            ? `Edit: ${editing.municipality}, ${editing.province}`
            : "Add 10-Year SWM Plan Record"
        }
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        width={920}
        style={{ maxWidth: "95vw" }}
        okText={editing ? "Update" : "Create"}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" size="small">
          <Collapse
            defaultActiveKey={[
              "location",
              "personnel",
              "compliance",
              "waste",
              "document",
            ]}
            bordered={false}
            items={[
              {
                key: "location",
                label: (
                  <span style={{ color: "#1677ff" }}>
                    <EnvironmentOutlined /> Location & Plan
                  </span>
                ),
                children: (
                  <>
                    <Row gutter={12}>
                      <Col xs={24} sm={8}>
                        <Form.Item
                          label={
                            <>
                              <EnvironmentOutlined /> Province
                            </>
                          }
                          name="province"
                          rules={[{ required: true, message: "Required" }]}
                        >
                          <Select
                            options={provinceOptions}
                            placeholder="Select province"
                            showSearch
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={8}>
                        <Form.Item
                          label={
                            <>
                              <EnvironmentOutlined /> Municipality
                            </>
                          }
                          name="municipality"
                          rules={[{ required: true, message: "Required" }]}
                        >
                          <Input placeholder="Municipality / City" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={4}>
                        <Form.Item label="MBA" name="manilaBayArea">
                          <Select options={mbaOptions} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={4}>
                        <Form.Item
                          label="District"
                          name="congressionalDistrict"
                        >
                          <Input placeholder="e.g. 1st" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={12}>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label={
                            <>
                              <GlobalOutlined /> Longitude
                            </>
                          }
                          name="longitude"
                        >
                          <InputNumber
                            style={{ width: "100%" }}
                            step={0.0001} precision={4}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label={
                            <>
                              <GlobalOutlined /> Latitude
                            </>
                          }
                          name="latitude"
                        >
                          <InputNumber
                            style={{ width: "100%" }}
                            step={0.0001} precision={4}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider
                      plain
                      orientation="left"
                      style={{ margin: "8px 0" }}
                    >
                      <AuditOutlined /> Plan Details
                    </Divider>
                    <Row gutter={12}>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label={
                            <>
                              <FileTextOutlined /> SWM Plan Type
                            </>
                          }
                          name="typeOfSWMPlan"
                        >
                          <Select options={typeOfPlanOptions} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label={
                            <>
                              <FileTextOutlined /> Resolution No.
                            </>
                          }
                          name="resolutionNo"
                        >
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col xs={8} sm={4}>
                        <Form.Item
                          label={
                            <>
                              <CalendarOutlined /> Period Covered
                            </>
                          }
                          name="periodCovered"
                        >
                          <Input placeholder="e.g. 2025-2034" />
                        </Form.Item>
                      </Col>
                      <Col xs={8} sm={4}>
                        <Form.Item
                          label={
                            <>
                              <CalendarOutlined /> Year Approved
                            </>
                          }
                          name="yearApproved"
                        >
                          <InputNumber
                            style={{ width: "100%" }}
                            min={2000}
                            max={2050}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={8} sm={4}>
                        <Form.Item
                          label={
                            <>
                              <CalendarOutlined /> End Period
                            </>
                          }
                          name="endPeriod"
                        >
                          <InputNumber
                            style={{ width: "100%" }}
                            min={2000}
                            max={2060}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={12}>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label={
                            <>
                              <AuditOutlined /> Status
                            </>
                          }
                          name="forRenewal"
                        >
                          <Select options={planStatusOptions} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </>
                ),
              },
              {
                key: "personnel",
                label: (
                  <span style={{ color: "#52c41a" }}>
                    <TeamOutlined /> Personnel & Monitoring
                  </span>
                ),
                children: (
                  <>
                    <Row gutter={12}>
                      <Col xs={24} sm={8}>
                        <Form.Item
                          label={
                            <>
                              <SolutionOutlined /> ENMO Assigned
                            </>
                          }
                          name="enmoAssigned"
                        >
                          <Select
                            options={enmoOptions}
                            allowClear
                            showSearch
                            placeholder="Select ENMO"
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={8}>
                        <Form.Item
                          label={
                            <>
                              <UserOutlined /> ESWM Staff
                            </>
                          }
                          name="eswmStaff"
                        >
                          <Select
                            options={eswmStaffOptions}
                            allowClear
                            showSearch
                            placeholder="Select Staff"
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={8}>
                        <Form.Item
                          label={
                            <>
                              <UserOutlined /> Focal Person
                            </>
                          }
                          name="focalPerson"
                        >
                          <Select
                            options={focalOptions}
                            allowClear
                            showSearch
                            placeholder="Select Focal"
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider
                      plain
                      orientation="left"
                      style={{ margin: "8px 0" }}
                    >
                      <CalendarOutlined /> Monitoring
                    </Divider>
                    <Row gutter={12}>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label={
                            <>
                              <CalendarOutlined /> Target Month
                            </>
                          }
                          name="targetMonth"
                        >
                          <Select options={monthOptions} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item label="IIS Number" name="iisNumber">
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Date of Monitoring"
                          name="dateOfMonitoring"
                        >
                          <DatePicker style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Date Report Prepared"
                          name="dateReportPrepared"
                        >
                          <DatePicker style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={12}>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Reviewed (Staff)"
                          name="dateReportReviewedStaff"
                        >
                          <DatePicker style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Reviewed (Focal)"
                          name="dateReportReviewedFocal"
                        >
                          <DatePicker style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Date Approved"
                          name="dateReportApproved"
                        >
                          <DatePicker style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item label="Tracking" name="trackingOfReports">
                          <Input />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider
                      plain
                      orientation="left"
                      style={{ margin: "8px 0" }}
                    >
                      <ClockCircleOutlined /> Processing Days
                    </Divider>
                    <Row gutter={12}>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Days (Prepared)"
                          name="totalDaysReportPrepared"
                        >
                          <InputNumber style={{ width: "100%" }} min={0} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Days (Staff Rev.)"
                          name="totalDaysReviewedStaff"
                        >
                          <InputNumber style={{ width: "100%" }} min={0} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Days (Focal Rev.)"
                          name="totalDaysReviewedFocal"
                        >
                          <InputNumber style={{ width: "100%" }} min={0} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Days (Approved)"
                          name="totalDaysApproved"
                        >
                          <InputNumber style={{ width: "100%" }} min={0} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </>
                ),
              },
              {
                key: "compliance",
                label: (
                  <span style={{ color: "#eb2f96" }}>
                    <CheckCircleOutlined /> Compliance
                  </span>
                ),
                children: (
                  <>
                    <Row gutter={12}>
                      <Col xs={12} sm={6}>
                        <Form.Item label="PCG" name="pcg">
                          <InputNumber style={{ width: "100%" }} step={0.001} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Total Waste Gen. (kg/day)"
                          name="totalWasteGeneration"
                        >
                          <InputNumber style={{ width: "100%" }} step={0.01} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Diversion Rate (%)"
                          name="wasteDiversionRate"
                        >
                          <InputNumber style={{ width: "100%" }} step={0.01} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="LGU Final Disposal"
                          name="lguFinalDisposal"
                        >
                          <Input />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={12}>
                      <Col xs={24} sm={8}>
                        <Form.Item
                          label="Compliance"
                          name="remarksAndRecommendation"
                        >
                          <Select options={planComplianceOptions} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider
                      plain
                      orientation="left"
                      style={{ margin: "8px 0" }}
                    >
                      <SafetyCertificateOutlined /> ESWM Components
                    </Divider>
                    <Row gutter={12}>
                      <Col xs={12} sm={4}>
                        <Form.Item
                          label="Source Reduction"
                          name="sourceReduction"
                        >
                          <Select options={yesNoOptions} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={4}>
                        <Form.Item
                          label="Segregated Coll."
                          name="segregatedCollection"
                        >
                          <Select options={yesNoOptions} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={4}>
                        <Form.Item
                          label="Storage/Setout"
                          name="storageAndSetout"
                        >
                          <Select options={yesNoOptions} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={4}>
                        <Form.Item label="Processing MRF" name="processingMRF">
                          <Select options={yesNoOptions} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={4}>
                        <Form.Item
                          label="Transfer Station"
                          name="transferStation"
                        >
                          <Select options={yesNoOptions} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={4}>
                        <Form.Item
                          label="Disposal Fac."
                          name="disposalFacilities"
                        >
                          <Select options={yesNoOptions} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider
                      plain
                      orientation="left"
                      style={{ margin: "8px 0" }}
                    >
                      <FileTextOutlined /> Advise & Remarks
                    </Divider>
                    <Row gutter={12}>
                      <Col xs={24} sm={8}>
                        <Form.Item
                          label="Advise Letter Date"
                          name="adviseLetterDateIssued"
                        >
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={8}>
                        <Form.Item
                          label="Compliance to Advise"
                          name="complianceToAdvise"
                        >
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={8}>
                        <Form.Item label="Remarks" name="remarks">
                          <Input />
                        </Form.Item>
                      </Col>
                    </Row>
                  </>
                ),
              },
              {
                key: "waste",
                label: (
                  <span style={{ color: "#722ed1" }}>
                    <FundProjectionScreenOutlined /> Waste Composition
                  </span>
                ),
                children: (
                  <>
                    <Row gutter={12}>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Biodegradable (kg/day)"
                          name="biodegradableWaste"
                        >
                          <InputNumber style={{ width: "100%" }} step={0.01} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item label="Bio (%)" name="biodegradablePercent">
                          <InputNumber
                            style={{ width: "100%" }}
                            step={0.0001}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Recyclable (kg/day)"
                          name="recyclableWaste"
                        >
                          <InputNumber style={{ width: "100%" }} step={0.01} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Recyclable (%)"
                          name="recyclablePercent"
                        >
                          <InputNumber
                            style={{ width: "100%" }}
                            step={0.0001}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={12}>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Residual Potential (kg/day)"
                          name="residualWithPotential"
                        >
                          <InputNumber style={{ width: "100%" }} step={0.01} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Residual Potential (%)"
                          name="residualWithPotentialPercent"
                        >
                          <InputNumber
                            style={{ width: "100%" }}
                            step={0.0001}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Residual Disposal (kg/day)"
                          name="residualWasteForDisposal"
                        >
                          <InputNumber style={{ width: "100%" }} step={0.01} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item label="Residual (%)" name="residualPercent">
                          <InputNumber
                            style={{ width: "100%" }}
                            step={0.0001}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={12}>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Special Waste (kg/day)"
                          name="specialWaste"
                        >
                          <InputNumber style={{ width: "100%" }} step={0.01} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item label="Special (%)" name="specialPercent">
                          <InputNumber
                            style={{ width: "100%" }}
                            step={0.0001}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item
                          label="Diversion Rate (calc)"
                          name="wasteDiversionRateCalc"
                        >
                          <InputNumber
                            style={{ width: "100%" }}
                            step={0.0001}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={6}>
                        <Form.Item label="Disposal Rate" name="disposalRate">
                          <InputNumber
                            style={{ width: "100%" }}
                            step={0.0001}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  </>
                ),
              },
              {
                key: "document",
                label: (
                  <span style={{ color: "#13c2c2" }}>
                    <LinkOutlined /> Document
                  </span>
                ),
                children: (
                  <Row gutter={12}>
                    <Col span={24}>
                      <Form.Item
                        label="Signed Document URL"
                        name="signedDocument"
                      >
                        <Input placeholder="https://..." />
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
