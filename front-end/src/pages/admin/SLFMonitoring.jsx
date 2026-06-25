import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  Card,
  List,
  Segmented,
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
  Descriptions,
  Badge,
  Popconfirm,
  Switch,
  Spin,
  Empty,
  Progress,
  Skeleton,
  Alert,
  Upload,
  Image,
  message,
  Checkbox,
  Avatar,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
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
  BarChartOutlined,
  InboxOutlined,
  CarOutlined,
  FilterOutlined,
  ClearOutlined,
  SafetyCertificateOutlined,
  BankOutlined,
  MinusCircleOutlined,
  LinkOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  AlertOutlined,
  UserOutlined,
  SolutionOutlined,
  UndoOutlined,
  BellOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  MailOutlined,
  SendOutlined,
  WarningOutlined,
  UploadOutlined,
  TableOutlined,
  PieChartOutlined,
  FileImageOutlined,
  FolderOutlined,
  FilePdfOutlined,
  ContainerOutlined,
  CalculatorOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import secureStorage from "../../utils/secureStorage";
import { getAdminDisplayName } from "../../utils/adminIdentity";
import { fetchWithCache, invalidateCache } from "../../utils/pageCache";
import { getSocket } from "../../utils/socket";
import { useDataRef } from "../../utils/dataRef";
import dayjs from "dayjs";
import { buildFilters, matchesFilter, rowMatchesSearch } from "./shared/tableFilters";
import {
  PieChart,
  Pie,
  Cell as RCell,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import ResponsiveTable from "./shared/ResponsiveTable";
import {
  getSubmissionVolumeSummary,
  getTruckCapacityText,
  getTruckPlateText,
  normalizeSubmissionRecord,
} from "./shared/submissionRecords";

const { Title, Text } = Typography;
const ACCENT = "#2f54eb";
const CHART_COLORS = [
  "#2f54eb",
  "#52c41a",
  "#faad14",
  "#ff4d4f",
  "#13c2c2",
  "#722ed1",
  "#eb2f96",
];

const managementStatusSummary = (items = []) => {
  const counts = items.reduce((acc, item) => {
    const status = item.status || item.condition || item.remarks || "Recorded";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([status, count]) => `${status}: ${count}`)
    .join("\n");
};
const UNIT_OPTIONS = [
  { label: "m³", value: "m³" },
  { label: "tons", value: "tons" },
];
const CELL_STATUS_OPTIONS = [
  { label: "Active Cell", value: "Active Cell" },
  { label: "Used/Completed", value: "Used/Completed" },
  { label: "Under Construction", value: "Under Construction" },
  { label: "Reserved Area", value: "Reserved Area" },
  { label: "Not Existed", value: "Not Existed" },
];
const CELL_STATUS_COLORS = {
  "Active Cell": {
    border: "#52c41a",
    bg: "#f6ffed",
    dark: "rgba(82,196,26,0.08)",
    tag: "success",
  },
  "Used/Completed": {
    border: "#8c8c8c",
    bg: "#f5f5f5",
    dark: "rgba(140,140,140,0.08)",
    tag: "default",
  },
  "Under Construction": {
    border: "#fa8c16",
    bg: "#fff7e6",
    dark: "rgba(250,140,22,0.08)",
    tag: "warning",
  },
  "Reserved Area": {
    border: "#722ed1",
    bg: "#f9f0ff",
    dark: "rgba(114,46,209,0.08)",
    tag: "purple",
  },
  "Not Existed": {
    border: "#bfbfbf",
    bg: "#fafafa",
    dark: "rgba(191,191,191,0.08)",
    tag: "default",
  },
};
const PERMIT_STATUS_OPTIONS = [
  { label: "New", value: "New" },
  { label: "Renewal", value: "Renewal" },
];
const DP_TYPE_OPTIONS = [
  { label: "Domestic", value: "Domestic" },
  { label: "Industrial", value: "Industrial" },
];
const WWTF_TYPE_OPTIONS = [
  "Primary Treatment",
  "Preliminary Treatment",
  "Biological",
  "Chemical",
  "Physical-Chemical Treatment",
  "Tertiary Treatment",
  "Disinfection",
  "Constructed Wetland",
  "Leachate Recirculation",
  "Other",
].map((value) => ({ label: value, value }));
const asStringArray = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
};
const formatStringArray = (value) => asStringArray(value).join(", ");
const RECEIVING_FACILITY_TYPE_OPTIONS = [
  "Material Recovery Facility (MRF)",
  "Sorting Facility",
  "Transfer Station",
  "RCA",
].map((value) => ({ label: value, value }));
const GALLERY_COMPONENT_OPTIONS = [
  "Entrance / Weighbridge",
  "Active Cell",
  "Completed Cell",
  "Leachate Pond",
  "Gas Management",
  "Drainage",
  "Access Road",
  "Office / Support Facility",
  "Other",
].map((value) => ({ label: value, value }));
const normalizeUnit = (unit) => (unit || "m³").replace("m3", "m³");
const TON_PER_M3 = 0.2;
const ACTIVE_VOLUME_STATUSES = new Set([
  "pending",
  "acknowledged",
  "revert_requested",
]);

const normalizeCellStatus = (status) => {
  const value = String(status || "").trim();
  if (/^operational$/i.test(value)) return "Active Cell";
  if (/^closed$/i.test(value)) return "Used/Completed";
  if (/^reserved cell$/i.test(value)) return "Reserved Area";
  return value || "Active Cell";
};

const isActiveCellStatus = (status) =>
  ["Active Cell", "Operational", "Active"].includes(String(status || ""));

const isCompletedCellStatus = (status) =>
  ["Used/Completed", "Closed"].includes(String(status || ""));

const getUploadHeaders = () => {
  const token = secureStorage.get("token");
  const user = secureStorage.getJSON("user") || {};
  const userName = getAdminDisplayName(user);
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(userName || user.username || user.email
      ? { "X-User-Name": userName || user.username || user.email }
      : {}),
    ...(user.email ? { "X-User-Email": user.email } : {}),
  };
};

const MAX_SLF_UPLOAD_MB = 200;
const MAX_SLF_UPLOAD_BYTES = MAX_SLF_UPLOAD_MB * 1024 * 1024;

const formatFileSize = (bytes) => {
  const size = Number(bytes || 0);
  if (!size) return "";
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
};

const getUploadFileSize = (file) =>
  file?.size || file?.originFileObj?.size || file?.response?.size || 0;

const validateSlfUpload = (file) => {
  if (file?.size > MAX_SLF_UPLOAD_BYTES) {
    message.error(`${file.name} is larger than ${MAX_SLF_UPLOAD_MB} MB.`);
    return Upload.LIST_IGNORE;
  }
  return true;
};

const renderSlfUploadItem = (originNode, file) => {
  const sizeText = formatFileSize(getUploadFileSize(file));
  const percent =
    file?.status === "uploading" && Number.isFinite(file?.percent)
      ? ` - ${Math.round(file.percent)}%`
      : "";
  if (!sizeText && !percent) return originNode;
  return (
    <div className="slf-upload-list-item">
      {originNode}
      <Text
        type="secondary"
        style={{ display: "block", fontSize: 11, lineHeight: 1.3, marginTop: 2 }}
      >
        {sizeText}
        {percent}
      </Text>
    </div>
  );
};

const slfUploadProps = {
  beforeUpload: validateSlfUpload,
  itemRender: renderSlfUploadItem,
  progress: { showInfo: true },
};

const convertVolume = (value, fromUnit = "tons", toUnit = fromUnit) => {
  const number = Number(value || 0);
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit || from);
  if (!number || from === to) return number;
  if (from === "tons" && to === "m³") return number / TON_PER_M3;
  if (from === "m³" && to === "tons") return number * TON_PER_M3;
  return number;
};

const getWasteKind = (wasteType) => {
  const value = String(wasteType || "").toLowerCase();
  if (value.includes("haz") || value.includes("inert")) return "hazardous";
  return "residual";
};

const isHazardousCellType = (cellType) =>
  /haz|inert/i.test(String(cellType || ""));

// Extract a Google Drive file id from any of its URL shapes.
const extractDriveId = (url) => {
  const s = String(url || "");
  let m = s.match(/\/file\/d\/([^/?#]+)/);
  if (m) return m[1];
  m = s.match(/[?&]id=([^&#]+)/);
  if (m) return m[1];
  m = s.match(/\/d\/([^/?#]+)/);
  if (m) return m[1];
  return "";
};

const isDriveUrl = (url) =>
  /drive\.google\.com|googleusercontent\.com|docs\.google\.com/.test(
    String(url || ""),
  );

// Resolve a stored media URL into something directly usable by <img>/<a>.
// Google Drive "webViewLink" values are viewer pages and cannot be used as an
// image source — convert them to a direct thumbnail/view URL instead.
const resolveMediaUrl = (url, { thumbnail = false } = {}) => {
  const s = String(url || "");
  if (!s) return "";
  if (isDriveUrl(s)) {
    const id = extractDriveId(s);
    if (id) {
      return thumbnail
        ? `https://drive.google.com/thumbnail?id=${id}&sz=w1200`
        : `https://drive.google.com/uc?export=view&id=${id}`;
    }
  }
  return s;
};

const normalizeStoredFileUrl = (value) => {
  if (!value) return "";
  if (Array.isArray(value))
    return value[0]?.response?.url || value[0]?.url || value[0] || "";
  if (typeof value === "object") return value.response?.url || value.url || "";
  return value;
};

// ── Consolidated SLF Dashboard (shown inside the SLF Data Table view modal) ──
function SlfDashboardTab({ dashboard, isDark }) {
  const [page, setPage] = useState(1);
  if (!dashboard || dashboard.totalSubmissions === 0) {
    return (
      <Empty
        description="No portal submissions for this SLF yet"
        style={{ padding: 40 }}
      />
    );
  }
  const {
    unit,
    totalSubmissions,
    totalTrucks,
    totalVolume,
    residual,
    hazardous,
    generatorCount,
    companyTypeData,
    cellData,
    monthly,
    topGenerators,
    statusData,
    tableRows,
  } = dashboard;

  const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
  const tiles = [
    { label: "Submissions", value: totalSubmissions, color: "#2f54eb", icon: <InboxOutlined /> },
    { label: "Truck Trips", value: totalTrucks, color: "#fa8c16", icon: <CarOutlined /> },
    { label: `Total Volume (${unit})`, value: fmt(totalVolume), color: "#722ed1", icon: <DatabaseOutlined /> },
    { label: "Generators", value: generatorCount, color: "#13c2c2", icon: <TeamOutlined /> },
    { label: `Residual (${unit})`, value: fmt(residual), color: "#52c41a", icon: <BarChartOutlined /> },
    { label: `Hazardous (${unit})`, value: fmt(hazardous), color: "#cf1322", icon: <WarningOutlined /> },
  ];

  const wasteComposition = [
    { name: "Residual", value: Math.round(residual) },
    { name: "Hazardous", value: Math.round(hazardous) },
  ].filter((d) => d.value > 0);

  const cardStyle = { borderRadius: 10, height: "100%" };
  const axisTick = { fontSize: 11, fill: isDark ? "#aaa" : "#555" };

  return (
    <div>
      <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
        {tiles.map((t) => (
          <Col xs={12} sm={8} md={8} lg={4} key={t.label}>
            <Card size="small" style={{ borderRadius: 10, borderLeft: `4px solid ${t.color}` }} styles={{ body: { padding: "10px 12px" } }}>
              <Space align="center" size={8}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: `${t.color}1f`, color: t.color, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>
                  {t.icon}
                </span>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: t.color, lineHeight: 1.1 }}>{t.value}</div>
                  <Text type="secondary" style={{ fontSize: 10 }}>{t.label}</Text>
                </div>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={8}>
          <Card size="small" title={<Text style={{ fontSize: 12 }}><PieChartOutlined /> Waste Composition ({unit})</Text>} style={cardStyle}>
            {wasteComposition.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={wasteComposition} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value" label={({ name, value }) => `${name}: ${value.toLocaleString()}`} labelLine={false}>
                    {wasteComposition.map((d, i) => (
                      <RCell key={d.name} fill={d.name === "Hazardous" ? "#cf1322" : "#52c41a"} />
                    ))}
                  </Pie>
                  <RTooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No volume" />}
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" title={<Text style={{ fontSize: 12 }}><PieChartOutlined /> Submissions by Source</Text>} style={cardStyle}>
            {companyTypeData.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={companyTypeData} cx="50%" cy="50%" outerRadius={75} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                    {companyTypeData.map((d, i) => (
                      <RCell key={d.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <RTooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No data" />}
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" title={<Text style={{ fontSize: 12 }}><BarChartOutlined /> Top Generators ({unit})</Text>} style={cardStyle}>
            {topGenerators.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={topGenerators} layout="vertical" margin={{ left: 8, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={axisTick} />
                  <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10, fill: isDark ? "#aaa" : "#555" }} />
                  <RTooltip />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {topGenerators.map((d, i) => (
                      <RCell key={d.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No data" />}
          </Card>
        </Col>
      </Row>

      <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={14}>
          <Card size="small" title={<Text style={{ fontSize: 12 }}><BarChartOutlined /> Monthly Disposal Trend ({unit})</Text>} style={cardStyle}>
            {monthly.length ? (
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={monthly} margin={{ left: 4, right: 12, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={axisTick} />
                  <YAxis tick={axisTick} />
                  <RTooltip />
                  <Line type="monotone" dataKey="volume" stroke="#2f54eb" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No trend data" />}
          </Card>
        </Col>
        <Col xs={24} md={10}>
          <Card size="small" title={<Text style={{ fontSize: 12 }}><PieChartOutlined /> Submission Status</Text>} style={cardStyle}>
            {statusData.length ? (
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie data={statusData} cx="50%" cy="50%" innerRadius={40} outerRadius={75} paddingAngle={2} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                    {statusData.map((d, i) => (
                      <RCell key={d.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <RTooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No data" />}
          </Card>
        </Col>
      </Row>

      <Card size="small" title={<Text style={{ fontSize: 12 }}><BarChartOutlined /> Cell Utilization ({unit})</Text>} style={{ borderRadius: 10, marginBottom: 12 }}>
        {cellData.length ? (
          <Row gutter={[10, 10]}>
            <Col xs={24} md={14}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={cellData} margin={{ left: 4, right: 12, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={axisTick} />
                  <YAxis tick={axisTick} />
                  <RTooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="capacity" name="Capacity" fill="#d6e4ff" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="used" name="Used" fill="#2f54eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Col>
            <Col xs={24} md={10}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {cellData.map((c) => (
                  <div key={c.name}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                      <Text strong style={{ fontSize: 11 }}>
                        {c.name}{" "}
                        <Tag color={isHazardousCellType(c.type) ? "volcano" : "blue"} style={{ fontSize: 9, marginLeft: 2 }}>
                          {c.type}
                        </Tag>
                      </Text>
                      <Text type="secondary" style={{ fontSize: 10 }}>
                        {fmt(c.used)} / {c.capacity ? fmt(c.capacity) : "—"} {unit}
                      </Text>
                    </div>
                    <Progress
                      percent={c.pct == null ? 0 : Math.round(c.pct)}
                      size="small"
                      status={c.pct >= 90 ? "exception" : c.pct >= 75 ? "active" : "normal"}
                      strokeColor={c.pct >= 90 ? "#ff4d4f" : c.pct >= 75 ? "#faad14" : "#52c41a"}
                    />
                  </div>
                ))}
              </div>
            </Col>
          </Row>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No cell infrastructure configured" />}
      </Card>

      <Card size="small" title={<Text style={{ fontSize: 12 }}><InboxOutlined /> Submissions</Text>} style={{ borderRadius: 10 }}>
        <ResponsiveTable
          size="small"
          dataSource={tableRows}
          rowKey="_id"
          pagination={{ current: page, pageSize: 8, onChange: setPage, size: "small", showSizeChanger: false }}
          scroll={{ x: 720 }}
          columns={[
            { title: "ID No.", dataIndex: "idNo", key: "idNo", width: 140, render: (v) => <Text style={{ fontSize: 11 }}>{v || "—"}</Text> },
            { title: "Date", dataIndex: "dateOfDisposal", key: "date", width: 110, render: (v) => <Text style={{ fontSize: 11 }}>{v ? dayjs(v).format("MM/DD/YYYY") : "—"}</Text> },
            { title: "Generator", dataIndex: "lguCompanyName", key: "gen", render: (v, r) => <span style={{ fontSize: 11 }}>{v || "—"} <Tag color={r.companyType === "Private" ? "green" : "blue"} style={{ fontSize: 9 }}>{r.companyType || "—"}</Tag></span> },
            { title: "Trucks", dataIndex: "truckCount", key: "trucks", width: 70, align: "center", render: (v) => <Text style={{ fontSize: 11 }}>{v}</Text> },
            { title: `Volume (${unit})`, dataIndex: "volume", key: "vol", width: 110, align: "right", render: (v) => <Text style={{ fontSize: 11 }}>{fmt(v)}</Text> },
            { title: "Status", dataIndex: "status", key: "status", width: 110, render: (v) => <Tag style={{ fontSize: 10 }} color={{ pending: "gold", acknowledged: "green", rejected: "red", reverted: "volcano" }[v] || "default"}>{String(v || "pending").replace("_", " ")}</Tag> },
          ]}
        />
      </Card>
    </div>
  );
}


const formatVolume = (value, unit = "tons") => {
  const number = Number(value || 0);
  return `${number.toLocaleString(undefined, { maximumFractionDigits: number >= 100 ? 0 : 2 })} ${normalizeUnit(unit)}`;
};

const CACHE_KEY = "slf-facility-cache-v6";
const CACHE_TTL = 5 * 60 * 1000;

const R3_PROVINCES = [
  "Bataan",
  "Bulacan",
  "Nueva Ecija",
  "Pampanga",
  "Tarlac",
  "Zambales",
  "Aurora",
];

const formatCompact = (value, digits = 1) => {
  const number = Number(value || 0);
  if (Math.abs(number) >= 1000000)
    return `${(number / 1000000).toFixed(digits)}M`;
  if (Math.abs(number) >= 1000) return `${(number / 1000).toFixed(digits)}k`;
  return number.toLocaleString();
};

const sumBy = (items, getter) =>
  items.reduce((sum, item) => sum + Number(getter(item) || 0), 0);

const getNameVariants = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const noParens = raw.replace(/\s*\(.*?\)\s*/g, " ").trim();
  const withoutPrefix = noParens
    .replace(/^province\s+of\s+/i, "")
    .replace(
      /^(local\s+governm\s*ent\s+unit|lgu|municipality\s+of|city\s+of)\s*[-:\u2012-\u2015]?\s*/i,
      "",
    )
    .trim();
  const firstCommaPart = withoutPrefix.split(",")[0]?.trim();
  return [
    ...new Set([raw, noParens, withoutPrefix, firstCommaPart].filter(Boolean)),
  ];
};

const normalizeSlfKey = (value) =>
  String(value || "")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\blocal\s+governm\s*ent\s+unit\b/gi, " ")
    .replace(/\blgu\b/gi, " ")
    .replace(/\bmunicipality\s+of\b/gi, " ")
    .replace(/\bcity\s+of\b/gi, " ")
    .replace(/^province\s+of\s+/i, "")
    .replace(/[\u2012-\u2015-]+/g, " ")
    .replace(/[,.;:/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const expandSlfNames = (names = []) => [
  ...new Set(names.flatMap((name) => getNameVariants(name)).filter(Boolean)),
];

const getFacilitySlfNames = (record) =>
  [
    ...(record?.slfGenerator && typeof record.slfGenerator === "object"
      ? [record.slfGenerator.slfName]
      : []),
    record?.slfName,
    record?.lgu,
    record?.lgu && record?.province
      ? `${record.lgu}, ${record.province}`
      : null,
    record?.province,
  ].filter(Boolean);

const getBaselineSlfNames = (baseline) =>
  expandSlfNames([baseline?.slfName, baseline?.lguCompanyName]);

const getSubmissionSlfNames = (submission) =>
  expandSlfNames([
    submission?.slfName,
    submission?.slfGenerator && typeof submission.slfGenerator === "object"
      ? submission.slfGenerator.slfName
      : null,
  ]);

const getRecordIds = (record) =>
  [
    record?._id,
    record?.slfGenerator && typeof record.slfGenerator === "object"
      ? record.slfGenerator._id
      : record?.slfGenerator,
  ]
    .filter(Boolean)
    .map(String);

const getSubmissionSlfId = (submission) => {
  const value = submission?.slfGenerator;
  if (!value) return "";
  return String(typeof value === "object" ? value._id : value);
};

const getDataEntryId = (entry) => (entry?._id ? String(entry._id) : "");

// Pre-index submissions by SLF id + normalized name so each facility can fetch
// only its candidate submissions in O(1) instead of scanning every submission
// (avoids the O(facilities × submissions) bottleneck on the SLF Data Table).
const buildSubmissionFacilityIndex = (submissions = []) => {
  const byKey = new Map();
  (submissions || []).forEach((sub) => {
    const keys = new Set();
    const id = getSubmissionSlfId(sub);
    if (id) keys.add(`id:${id}`);
    getSubmissionSlfNames(sub).forEach((name) => {
      const k = normalizeSlfKey(name);
      if (k) keys.add(`name:${k}`);
    });
    keys.forEach((key) => {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(sub);
    });
  });
  return byKey;
};

const getFacilityCandidateSubmissions = (record, byKey) => {
  if (!byKey) return [];
  const result = new Set();
  getRecordIds(record).forEach((id) => {
    (byKey.get(`id:${id}`) || []).forEach((s) => result.add(s));
  });
  expandSlfNames(getFacilitySlfNames(record)).forEach((name) => {
    const k = normalizeSlfKey(name);
    if (k) (byKey.get(`name:${k}`) || []).forEach((s) => result.add(s));
  });
  return [...result];
};

const isSameDataEntry = (left, right) => {
  const leftId = getDataEntryId(left);
  const rightId = getDataEntryId(right);
  return !!leftId && !!rightId && leftId === rightId;
};

const hasTruckVolume = (submission) =>
  (submission?.trucks || []).some(
    (truck) => Number(truck?.actualVolume || 0) > 0,
  );

const getPortalVolumeUnit = (baseline, submissions = [], record) =>
  normalizeUnit(
    submissions
      .flatMap((submission) => submission.trucks || [])
      .find(
        (truck) =>
          Number(truck?.actualVolume || 0) > 0 && truck.actualVolumeUnit,
      )?.actualVolumeUnit ||
      (baseline?.activeCellEntries || []).find(
        (entry) => Number(entry?.volume || 0) > 0 && entry.unit,
      )?.unit ||
      baseline?.baselineUnit ||
      baseline?.activeCellResidualUnit ||
      baseline?.totalVolumeAcceptedUnit ||
      record?.wasteReceivedUnit ||
      record?.cellFillUnits?.find(Boolean) ||
      record?.cellCapacityUnits?.find(Boolean) ||
      record?.volumeCapacityUnit ||
      "m³",
  );

const parseCellIndex = (cellName) => {
  const match = String(cellName || "").match(/(?:cell\s*)?(\d+)/i);
  return match ? Number(match[1]) - 1 : null;
};

const getTruckCellIndex = (truck) => {
  if (Number.isInteger(truck?.cellIndex)) return truck.cellIndex;
  const numericIndex = Number(truck?.cellIndex);
  if (Number.isInteger(numericIndex) && numericIndex >= 0) return numericIndex;
  return parseCellIndex(
    truck?.cellName ||
      truck?.activeCell ||
      truck?.cellPlacement ||
      truck?.submissionCellPlacement,
  );
};

const buildBaselineMap = (baselines = []) => {
  const map = new Map();
  baselines.forEach((baseline) => {
    getBaselineSlfNames(baseline).forEach((name) => {
      const key = normalizeSlfKey(name);
      if (key && !map.has(key)) map.set(key, baseline);
    });
  });
  return map;
};

const findBaselineForFacility = (record, baselineMap) => {
  for (const name of expandSlfNames(getFacilitySlfNames(record))) {
    const baseline = baselineMap.get(normalizeSlfKey(name));
    if (baseline) return baseline;
  }
  return null;
};

const submissionMatchesFacility = (record, submission) => {
  const submissionId = getSubmissionSlfId(submission);
  if (submissionId && getRecordIds(record).includes(submissionId)) return true;

  const recordKeys = expandSlfNames(getFacilitySlfNames(record)).map((name) =>
    normalizeSlfKey(name),
  );
  const submissionKeys = getSubmissionSlfNames(submission).map((name) =>
    normalizeSlfKey(name),
  );
  return submissionKeys.some((key) => key && recordKeys.includes(key));
};

const findBestCellIndex = (rows, wasteType, preferredIndex = null) => {
  if (
    preferredIndex != null &&
    rows[preferredIndex] &&
    isActiveCellStatus(rows[preferredIndex].status)
  )
    return preferredIndex;
  const kind = getWasteKind(wasteType);
  const activeMatch = rows.findIndex(
    (row) =>
      isActiveCellStatus(row.status) &&
      (kind === "hazardous" ? row.isHazardous : !row.isHazardous),
  );
  if (activeMatch >= 0) return activeMatch;
  const operational = rows.findIndex((row) => isActiveCellStatus(row.status));
  return operational >= 0 ? operational : 0;
};

const addVolumeToCell = (row, volume, source, wasteType, unit) => {
  const converted = convertVolume(volume, unit, row.unit);
  if (converted <= 0) return;
  row[source] += converted;
  row.total += converted;
  const kind = getWasteKind(wasteType);
  row.byWasteType[kind] = (row.byWasteType[kind] || 0) + converted;
};

const buildFacilityCellUsage = (record, baseline, submissions = []) => {
  const cellCount = Math.max(
    Number(record?.numberOfCell || 0),
    Array.isArray(record?.cellCapacities) ? record.cellCapacities.length : 0,
    Array.isArray(baseline?.activeCellEntries)
      ? baseline.activeCellEntries.length
      : 0,
    1,
  );
  const matchingSubmissions = submissions.filter(
    (submission) =>
      ACTIVE_VOLUME_STATUSES.has(submission.status || "pending") &&
      submissionMatchesFacility(record, submission) &&
      !isSameDataEntry(submission, baseline) &&
      hasTruckVolume(submission),
  );
  const targetUnit = getPortalVolumeUnit(baseline, matchingSubmissions, record);

  const rows = Array.from({ length: cellCount }, (_, index) => {
    const status = normalizeCellStatus(record?.cellStatuses?.[index]);
    const type = record?.cellTypes?.[index] || "Residual";
    return {
      key: `cell-${index + 1}`,
      index,
      cellName: `Cell ${index + 1}`,
      status,
      type,
      isHazardous: isHazardousCellType(type),
      capacity: Number(record?.cellCapacities?.[index] || 0),
      capacityUnit: normalizeUnit(
        record?.cellCapacityUnits?.[index] ||
          record?.volumeCapacityUnit ||
          "m³",
      ),
      unit: targetUnit,
      baseline: 0,
      submissions: 0,
      total: 0,
      byWasteType: {},
    };
  });

  const activeEntries = Array.isArray(baseline?.activeCellEntries)
    ? baseline.activeCellEntries
    : [];
  activeEntries.forEach((entry, orderIndex) => {
    const parsedIndex = parseCellIndex(entry.cellName);
    const targetIndex = findBestCellIndex(
      rows,
      entry.wasteType,
      parsedIndex != null && parsedIndex >= 0 ? parsedIndex : orderIndex,
    );
    const row = rows[targetIndex] || rows[0];
    if (entry.cellName) row.cellName = entry.cellName;
    addVolumeToCell(
      row,
      Number(entry.volume || 0),
      "baseline",
      entry.wasteType,
      entry.unit || baseline?.baselineUnit || targetUnit,
    );
  });

  if (activeEntries.length === 0 && baseline) {
    [
      {
        volume: baseline.activeCellResidualVolume,
        unit: baseline.activeCellResidualUnit,
        wasteType: "Residual",
      },
      {
        volume: baseline.activeCellInertVolume,
        unit: baseline.activeCellInertUnit,
        wasteType: "Treated Hazardous Waste",
      },
      {
        volume: baseline.activeCellHazardousVolume,
        unit: baseline.activeCellHazardousUnit,
        wasteType: "Hazardous Waste",
      },
    ].forEach((entry) => {
      const targetIndex = findBestCellIndex(rows, entry.wasteType);
      addVolumeToCell(
        rows[targetIndex] || rows[0],
        Number(entry.volume || 0),
        "baseline",
        entry.wasteType,
        entry.unit || targetUnit,
      );
    });
  }

  matchingSubmissions.forEach((submission) => {
    (submission.trucks || []).forEach((truck) => {
      const explicitIndex = getTruckCellIndex(truck);
      const targetIndex = findBestCellIndex(rows, truck.wasteType, explicitIndex);
      addVolumeToCell(
        rows[targetIndex] || rows[0],
        Number(truck.actualVolume || 0),
        "submissions",
        truck.wasteType,
        truck.actualVolumeUnit || "tons",
      );
    });
  });

  const totalBaseline = rows.reduce((sum, row) => sum + row.baseline, 0);
  const totalSubmissions = rows.reduce((sum, row) => sum + row.submissions, 0);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  return {
    rows,
    totalBaseline,
    totalSubmissions,
    total,
    unit: targetUnit,
    submissionCount: matchingSubmissions.length,
  };
};

const enrichFacilityWithBaseline = (record, baseline, submissions = []) => {
  if (!record) return record;
  const cellCount = Number(record.numberOfCell || 0);
  const usage = buildFacilityCellUsage(record, baseline, submissions);
  if (usage.total <= 0) return record;

  const currentFillValues = Array.isArray(record.cellFillValues)
    ? record.cellFillValues
    : [];
  const currentFillUnits = Array.isArray(record.cellFillUnits)
    ? record.cellFillUnits
    : [];
  const hasStoredFillValues = currentFillValues.some(
    (value) => value !== null && value !== undefined && value !== "",
  );
  const storedTargetUnit = normalizeUnit(record.wasteReceivedUnit || usage.unit);
  const storedFillTotal = currentFillValues.reduce(
    (sum, value, index) =>
      sum +
      convertVolume(
        value,
        currentFillUnits[index] || storedTargetUnit,
        storedTargetUnit,
      ),
    0,
  );
  const nextFillValues = Array.from(
    { length: Math.max(cellCount, usage.rows.length) },
    (_, index) =>
      currentFillValues[index] !== null && currentFillValues[index] !== undefined && currentFillValues[index] !== ""
        ? currentFillValues[index]
        : usage.rows[index]?.total > 0
          ? usage.rows[index].total
          : currentFillValues[index],
  );
  const nextFillUnits = nextFillValues.map(
    (_, index) =>
      currentFillUnits[index] || usage.rows[index]?.unit || usage.unit,
  );

  return {
    ...record,
    actualResidualWasteReceived: hasStoredFillValues
      ? Number(storedFillTotal.toFixed(3))
      : usage.total,
    wasteReceivedUnit: hasStoredFillValues ? storedTargetUnit : usage.unit,
    cellFillValues: nextFillValues,
    cellFillUnits: nextFillUnits,
    _baselineWasteReceived: usage.totalBaseline,
    _baselineWasteReceivedUnit: usage.unit,
    _submissionWasteReceived: usage.totalSubmissions,
    _submissionWasteReceivedUnit: usage.unit,
    _cellUsageRows: usage.rows,
    _cellUsageSubmissionCount: usage.submissionCount,
    _baselineActiveCellEntries: baseline?.activeCellEntries || [],
  };
};

function groupMetric(items, groupGetter, valueGetter) {
  const map = new Map();
  items.forEach((item) => {
    const name = groupGetter(item) || "Unspecified";
    map.set(name, (map.get(name) || 0) + Number(valueGetter(item) || 0));
  });
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
}

function topMetric(items, valueGetter, label = "value") {
  return items
    .map((item) => ({
      name: item.lgu || item.facilityName || item.province || "Unspecified SLF",
      province: item.province || "-",
      status: item.statusOfSLF || "-",
      ownership: item.ownership || "-",
      value: Number(valueGetter(item) || 0),
      label,
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
}

function DashboardMetricCard({
  active,
  color,
  icon,
  title,
  value,
  suffix,
  formatter,
  summary,
  breakdowns = [],
  onClick,
}) {
  return (
    <Card
      size="small"
      hoverable
      onClick={onClick}
      style={{
        borderRadius: 8,
        border: active ? `1px solid ${color}` : "1px solid #f0f0f0",
        borderTop: `3px solid ${color}`,
        height: "100%",
        minHeight: 118,
        cursor: "pointer",
        boxShadow: active ? `0 0 0 1px ${color}33` : "0 1px 3px rgba(15, 23, 42, 0.06)",
      }}
      bodyStyle={{ padding: "10px 12px", height: "100%" }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          height: "100%",
        }}
      >
        <Statistic
          title={<span style={{ fontSize: 11 }}>{title}</span>}
          value={value}
          suffix={suffix}
          valueStyle={{ fontSize: 18, lineHeight: 1.1 }}
          prefix={icon}
          formatter={formatter}
        />
        <div style={{ marginTop: "auto", minHeight: 34 }}>
          <Text strong style={{ display: "block", fontSize: 11, color }}>
            {summary}
          </Text>
          {breakdowns.slice(0, 2).map((item) => (
            <Text
              key={item}
              type="secondary"
              style={{ display: "block", fontSize: 10, lineHeight: 1.25 }}
            >
              {item}
            </Text>
          ))}
        </div>
      </div>
    </Card>
  );
}

function InsightStat({ title, value, suffix, color }) {
  return (
    <Card
      size="small"
      style={{
        borderRadius: 8,
        border: `1px solid ${color}33`,
        background: `${color}0d`,
        height: "100%",
      }}
    >
      <Statistic
        title={title}
        value={value}
        suffix={suffix}
        valueStyle={{ color, fontSize: 22 }}
        formatter={(v) => Number(v || 0).toLocaleString()}
      />
    </Card>
  );
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

// -- SLF Waste Baseline Info Sub-Tab --
function WasteBaselineInfo() {
  const [baselines, setBaselines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedGen, setExpandedGen] = useState(null);

  useEffect(() => {
    setLoading(true);
    api
      .get("/data-slf/baselines")
      .then(({ data }) => setBaselines(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const columns = [
    {
      title: "SLF Name",
      dataIndex: "slfName",
      key: "slfName",
      render: (t) => <Text strong>{t}</Text>,
    },
    {
      title: "Status",
      dataIndex: "isActive",
      key: "isActive",
      width: 100,
      render: (v) =>
        v ? <Tag color="green">Active</Tag> : <Tag color="red">Inactive</Tag>,
    },
    {
      title: "Total Volume Accepted",
      key: "totalVolumeAccepted",
      render: (_, r) =>
        r.totalVolumeAccepted != null
          ? `${r.totalVolumeAccepted.toLocaleString()} ${normalizeUnit(r.totalVolumeAcceptedUnit || r.baselineUnit)}`
          : "—",
    },
    {
      title: "Active Cell (Residual)",
      key: "activeCellResidual",
      render: (_, r) =>
        r.activeCellResidualVolume != null
          ? `${r.activeCellResidualVolume.toLocaleString()} ${normalizeUnit(r.activeCellResidualUnit || r.baselineUnit)}`
          : "—",
    },
    {
      title: "Active Cell (Inert)",
      key: "activeCellInert",
      render: (_, r) =>
        r.activeCellInertVolume != null
          ? `${r.activeCellInertVolume.toLocaleString()} ${normalizeUnit(r.activeCellInertUnit || r.baselineUnit)}`
          : "—",
    },
    {
      title: "Closed Cell (Residual)",
      key: "closedCellResidual",
      render: (_, r) =>
        r.closedCellResidualVolume != null
          ? `${r.closedCellResidualVolume.toLocaleString()} ${normalizeUnit(r.closedCellResidualUnit || r.baselineUnit)}`
          : "—",
    },
    {
      title: "Closed Cell (Inert)",
      key: "closedCellInert",
      render: (_, r) =>
        r.closedCellInertVolume != null
          ? `${r.closedCellInertVolume.toLocaleString()} ${normalizeUnit(r.closedCellInertUnit || r.baselineUnit)}`
          : "—",
    },
    {
      title: "Haulers",
      key: "haulers",
      width: 80,
      render: (_, r) => r.accreditedHaulers?.length || 0,
    },
    {
      title: "Submitted By",
      dataIndex: "submittedBy",
      key: "submittedBy",
      ellipsis: true,
      render: (v) => v || "—",
    },
    {
      title: "Last Updated",
      dataIndex: "lastUpdated",
      key: "lastUpdated",
      width: 140,
      render: (v) => (v ? dayjs(v).format("MM/DD/YYYY") : "—"),
    },
  ];

  const buildBaselineCellRows = (record, cellType) => {
    const entries =
      cellType === "active"
        ? record.activeCellEntries || []
        : record.closedCellEntries || [];
    const fallbackRows =
      cellType === "active"
        ? [
            {
              cellName: "Active Cell - Residual",
              wasteType: "Residual",
              volume: record.activeCellResidualVolume,
              unit: record.activeCellResidualUnit || record.baselineUnit,
            },
            {
              cellName: "Active Cell - Inert",
              wasteType: "Inert",
              volume: record.activeCellInertVolume,
              unit: record.activeCellInertUnit || record.baselineUnit,
            },
            {
              cellName: "Active Cell - Hazardous",
              wasteType: "Hazardous Waste",
              volume: record.activeCellHazardousVolume,
              unit: record.activeCellHazardousUnit || record.baselineUnit,
            },
          ]
        : [
            {
              cellName: "Closed Cell - Residual",
              wasteType: "Residual",
              volume: record.closedCellResidualVolume,
              unit: record.closedCellResidualUnit || record.baselineUnit,
            },
            {
              cellName: "Closed Cell - Inert",
              wasteType: "Inert",
              volume: record.closedCellInertVolume,
              unit: record.closedCellInertUnit || record.baselineUnit,
            },
            {
              cellName: "Closed Cell - Hazardous",
              wasteType: "Hazardous Waste",
              volume: record.closedCellHazardousVolume,
              unit: record.closedCellHazardousUnit || record.baselineUnit,
            },
          ];

    const source =
      entries.length > 0
        ? entries.map((entry, index) => ({
            key: `${cellType}-${index}`,
            cellNo: (parseCellIndex(entry.cellName) ?? index) + 1,
            cellName: entry.cellName || `Cell ${index + 1}`,
            wasteType: entry.wasteType || "Residual",
            volume: Number(entry.volume || 0),
            unit: record.baselineUnit || "m³",
          }))
        : fallbackRows.map((entry, index) => ({
            key: `${cellType}-fallback-${index}`,
            cellNo: index + 1,
            cellName: entry.cellName,
            wasteType: entry.wasteType,
            volume: Number(entry.volume || 0),
            unit: entry.unit || record.baselineUnit || "m³",
          }));

    return source
      .filter((entry) => entry.volume > 0)
      .sort(
        (a, b) => a.cellNo - b.cellNo || a.cellName.localeCompare(b.cellName),
      );
  };

  const baselineCellColumns = [
    {
      title: "Cell No.",
      dataIndex: "cellNo",
      width: 90,
      render: (value) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: "Cell Name",
      dataIndex: "cellName",
      render: (value) => <Text strong>{value}</Text>,
    },
    {
      title: "Waste Type",
      dataIndex: "wasteType",
      render: (value) => (
        <Tag color={getWasteKind(value) === "hazardous" ? "red" : "green"}>
          {value}
        </Tag>
      ),
    },
    {
      title: "Baseline Volume",
      key: "volume",
      align: "right",
      render: (_, row) => (
        <Text strong>{formatVolume(row.volume, row.unit)}</Text>
      ),
    },
  ];

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <Text type="secondary">
          Baseline waste volume information submitted by SLF portal users.
        </Text>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => {
            setLoading(true);
            api
              .get("/data-slf/baselines")
              .then(({ data }) => setBaselines(data))
              .catch(() => {})
              .finally(() => setLoading(false));
          }}
        >
          Refresh
        </Button>
      </div>
      <Table
        dataSource={baselines}
        columns={columns}
        rowKey="_id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 10 }}
        scroll={{ x: 1200 }}
        expandable={{
          expandedRowKeys: expandedGen ? [expandedGen] : [],
          onExpand: (expanded, record) =>
            setExpandedGen(expanded ? record._id : null),
          expandedRowRender: (record) => {
            const activeRows = buildBaselineCellRows(record, "active");
            const closedRows = buildBaselineCellRows(record, "closed");
            return (
              <Card
                size="small"
                style={{ borderRadius: 8 }}
                bodyStyle={{ padding: 8 }}
              >
                <Collapse
                  size="small"
                  defaultActiveKey={["active"]}
                  items={[
                    {
                      key: "active",
                      label: (
                        <Space>
                          <ContainerOutlined /> Active Cell Volumes{" "}
                          <Tag color="green">{activeRows.length}</Tag>
                        </Space>
                      ),
                      children:
                        activeRows.length > 0 ? (
                          <Table
                            dataSource={activeRows}
                            columns={baselineCellColumns}
                            rowKey="key"
                            size="small"
                            pagination={false}
                          />
                        ) : (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="No active cell baseline volumes"
                          />
                        ),
                    },
                    {
                      key: "closed",
                      label: (
                        <Space>
                          <DatabaseOutlined /> Closed Cell Volumes{" "}
                          <Tag>{closedRows.length}</Tag>
                        </Space>
                      ),
                      children:
                        closedRows.length > 0 ? (
                          <Table
                            dataSource={closedRows}
                            columns={baselineCellColumns}
                            rowKey="key"
                            size="small"
                            pagination={false}
                          />
                        ) : (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="No closed cell baseline volumes"
                          />
                        ),
                    },
                    {
                      key: "haulers",
                      label: (
                        <Space>
                          <TeamOutlined /> Accredited Haulers{" "}
                          <Tag color="blue">
                            {record.accreditedHaulers?.length || 0}
                          </Tag>
                        </Space>
                      ),
                      children:
                        record.accreditedHaulers?.length > 0 ? (
                          <Table
                            dataSource={record.accreditedHaulers}
                            rowKey={(_, i) => i}
                            size="small"
                            pagination={false}
                            columns={[
                              {
                                title: "Hauler Name",
                                dataIndex: "haulerName",
                                key: "haulerName",
                              },
                              {
                                title: "Number of Trucks",
                                dataIndex: "numberOfTrucks",
                                key: "numberOfTrucks",
                                render: (v) => v ?? "—",
                              },
                              {
                                title: "Private Sector Clients",
                                dataIndex: "privateSectorClients",
                                key: "privateSectorClients",
                                render: (v) => v || "—",
                              },
                            ]}
                          />
                        ) : (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="No accredited haulers"
                          />
                        ),
                    },
                  ]}
                />
              </Card>
            );
          },
          rowExpandable: () => true,
        }}
      />
    </>
  );
}

// -- Portal Generators Sub-Tab --
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
    api
      .get("/data-slf")
      .then(({ data }) =>
        setSubmissions((data || []).map(normalizeSubmissionRecord)),
      )
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
              valueStyle={{ fontSize: 20 }}
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
              valueStyle={{ fontSize: 20 }}
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
              valueStyle={{ fontSize: 20, color: "#faad14" }}
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
              valueStyle={{ fontSize: 20, color: "#52c41a" }}
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
              valueStyle={{
                fontSize: 20,
                color: revertRequestCount > 0 ? "#fa8c16" : undefined,
              }}
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
              valueStyle={{ fontSize: 20, color: "#722ed1" }}
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
            <Tag bordered={false} color="blue">
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
                valueStyle={{ fontSize: 18, color: "#722ed1" }}
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
            <Tag bordered={false} color="blue">
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
                  <Tag
                    bordered={false}
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
export default function SLFMonitoring({
  canEdit = true,
  canDelete = true,
  isDark,
}) {
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
  const slfStatusOptions = getValues("slf-status").map((v) => ({
    label: v,
    value: v,
  }));
  const ownershipOptions = getValues("ownership").map((v) => ({
    label: v,
    value: v,
  }));
  const wasteTypeOptions = getValues("waste-type").map((v) => ({
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
  const districtDefaults = ["Lone", "1st", "2nd", "3rd", "4th", "5th"];
  const districtRefValues = getValues("congressional-district");
  const districtOptions = (() => {
    const merged = [
      ...districtDefaults,
      ...districtRefValues.filter((v) => !districtDefaults.includes(v)),
    ];
    return merged.map((v) => ({
      label: v === "Lone" ? "Lone District" : `${v} District`,
      value: v,
    }));
  })();
  const categoryDefaults = [
    { label: "Category 1 \u2014 < 15 TPD", value: "Cat 1" },
    { label: "Category 2 \u2014 15\u201375 TPD", value: "Cat 2" },
    { label: "Category 3 \u2014 75\u2013150 TPD", value: "Cat 3" },
    { label: "Category 4 \u2014 > 150 TPD", value: "Cat 4" },
  ];
  const categoryRefValues = getValues("slf-category");
  const categoryOptions = (() => {
    const defaultVals = categoryDefaults.map((d) => d.value);
    const extra = categoryRefValues
      .filter((v) => !defaultVals.includes(v))
      .map((v) => ({ label: v, value: v }));
    return [...categoryDefaults, ...extra];
  })();

  const [records, setRecords] = useState([]);
  const [generators, setGenerators] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingGen, setLoadingGen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailModal, setDetailModal] = useState(null);
  const [galleryViewMode, setGalleryViewMode] = useState("tiled");
  const [detailYearRecords, setDetailYearRecords] = useState([]);
  const [detailYear, setDetailYear] = useState(null);
  const [baselineData, setBaselineData] = useState(null);
  const [loadingBaseline, setLoadingBaseline] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editYear, setEditYear] = useState(null);
  const [editYearRecords, setEditYearRecords] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [filterProvince, setFilterProvince] = useState(null);
  const [filterStatus, setFilterStatus] = useState(null);
  const [filterCategory, setFilterCategory] = useState(null);
  const [filterMonth, setFilterMonth] = useState(null);
  const [quickFilter, setQuickFilter] = useState(null);
  const [slfInsightModal, setSlfInsightModal] = useState(null);
  const [slfLguModal, setSlfLguModal] = useState(false);
  const [slfWasteModal, setSlfWasteModal] = useState(false);
  const [convArea, setConvArea] = useState(null);
  const [convDepth, setConvDepth] = useState(null);
  const [convVol, setConvVol] = useState(null);
  const [convDensity, setConvDensity] = useState(0.2);
  const [convM3ToTons, setConvM3ToTons] = useState(null);
  const [convModalOpen, setConvModalOpen] = useState(false);
  const [unitToolOpen, setUnitToolOpen] = useState(false);
  const [unitToolValue, setUnitToolValue] = useState("m³");
  const [saving, setSaving] = useState(false);
  const [capacityAlertModal, setCapacityAlertModal] = useState(null);
  const [capacityAlertSending, setCapacityAlertSending] = useState(false);
  const [mapPreview, setMapPreview] = useState(null);
  const [slfSubmissions, setSlfSubmissions] = useState([]);
  const [cellAssignmentModal, setCellAssignmentModal] = useState(null);
  const [cellAssignmentSaving, setCellAssignmentSaving] = useState(false);
  const [dailySubmissionsModal, setDailySubmissionsModal] = useState({
    open: false,
    cell: null,
    rows: [],
  });
  const [form] = Form.useForm();

  const normalizeSlfSubmissions = (items = []) =>
    (items || []).map(normalizeSubmissionRecord);

  const fetchRecords = useCallback(async (skipCache = false) => {
    await fetchWithCache(
      CACHE_KEY,
      async () => {
        const [
          { data: facilities },
          { data: baselines },
          { data: submissions },
        ] = await Promise.all([
          api.get("/slf-facilities"),
          api.get("/data-slf/baselines"),
          api.get("/data-slf"),
        ]);
        const normalizedSubmissions = normalizeSlfSubmissions(submissions);
        setSlfSubmissions(normalizedSubmissions);
        const baselineMap = buildBaselineMap(baselines || []);
        const submissionIndex = buildSubmissionFacilityIndex(normalizedSubmissions);
        return {
          records: (facilities || []).map((record) =>
            enrichFacilityWithBaseline(
              record,
              findBaselineForFacility(record, baselineMap),
              getFacilityCandidateSubmissions(record, submissionIndex),
            ),
          ),
          submissions: normalizedSubmissions,
        };
      },
      {
        ttl: CACHE_TTL,
        force: skipCache,
        onData: (data) => {
          const rows = Array.isArray(data) ? data : data?.records || [];
          setSlfSubmissions(Array.isArray(data) ? [] : data?.submissions || []);
          setRecords(rows.map((r) => ({ ...r, ...computeFields(r) })));
        },
        onError: () => Swal.fire("Error", "Failed to load records", "error"),
        onStart: () => setLoading(true),
        onEnd: () => setLoading(false),
      },
    );
  }, []);

  const fetchGenerators = useCallback(async () => {
    setLoadingGen(true);
    try {
      const { data } = await api.get("/slf-generators");
      setGenerators(data);
    } catch {
      /* silent */
    } finally {
      setLoadingGen(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
    fetchGenerators();
  }, [fetchRecords, fetchGenerators]);

  // Keep the SLF Monitoring Dashboard + Waste Generators tabs in sync with newly
  // submitted portal data. Driven by live socket events (no aggressive polling),
  // so it stays fresh without adding load to the SLF Data Table page.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const handler = ({ target } = {}) => {
      if (!target || target === "submissions" || target === "baselines") {
        invalidateCache(CACHE_KEY);
        fetchRecords(true);
        fetchGenerators();
      }
    };
    socket.on("data-refresh", handler);
    return () => socket.off("data-refresh", handler);
  }, [fetchRecords, fetchGenerators]);

  // Fetch baseline data when detail modal opens for a facility.
  useEffect(() => {
    if (!detailModal) {
      setBaselineData(null);
      return;
    }
    const candidateNames = expandSlfNames(getFacilitySlfNames(detailModal));
    if (candidateNames.length === 0) {
      setBaselineData(null);
      return;
    }
    setLoadingBaseline(true);
    api
      .get("/data-slf/baselines")
      .then(({ data }) => {
        const baselineMap = buildBaselineMap(data || []);
        setBaselineData(findBaselineForFacility(detailModal, baselineMap));
      })
      .catch(() => setBaselineData(null))
      .finally(() => setLoadingBaseline(false));
  }, [detailModal]);

  // Fetch cross-year history when viewing a facility record
  useEffect(() => {
    if (!detailModal) {
      setDetailYearRecords([]);
      setDetailYear(null);
      return;
    }
    const lgu = detailModal.lgu;
    if (!lgu) {
      setDetailYearRecords([]);
      setDetailYear(detailModal.dataYear || new Date().getFullYear());
      return;
    }
    api
      .get(`/slf-facilities/history/${encodeURIComponent(lgu)}`)
      .then(({ data }) => {
        const enriched = data.map((r) => ({ ...r, ...computeFields(r) }));
        setDetailYearRecords(enriched);
        setDetailYear(detailModal.dataYear || new Date().getFullYear());
      })
      .catch(() => {
        setDetailYearRecords([]);
        setDetailYear(detailModal.dataYear || new Date().getFullYear());
      });
  }, [detailModal]);

  const detailViewRecord = useMemo(() => {
    if (!detailModal) return null;
    const baseRecord =
      detailYearRecords.length === 0
        ? detailModal
        : detailYearRecords.find(
            (r) => (r.dataYear || new Date().getFullYear()) === detailYear,
          ) || null;
    // Include portal submissions so cell fill values reflect submitted volumes
    const facilitySubmissions = slfSubmissions.filter(
      (sub) =>
        ACTIVE_VOLUME_STATUSES.has(sub.status || "pending") &&
        submissionMatchesFacility(detailModal, sub),
    );
    return enrichFacilityWithBaseline(
      baseRecord,
      baselineData,
      facilitySubmissions,
    );
  }, [
    baselineData,
    detailModal,
    detailYearRecords,
    detailYear,
    slfSubmissions,
  ]);

  // Consolidated dashboard data for the "SLF Dashboard" tab in the view modal.
  const detailDashboard = useMemo(() => {
    const facility = detailViewRecord;
    if (!facility || !detailModal) return null;
    const subs = slfSubmissions.filter(
      (sub) =>
        ACTIVE_VOLUME_STATUSES.has(sub.status || "pending") &&
        submissionMatchesFacility(detailModal, sub),
    );
    const unit = normalizeUnit(
      facility.wasteReceivedUnit ||
        facility.volumeCapacityUnit ||
        facility.baselineUnit ||
        "m³",
    );
    let totalTrucks = 0;
    let totalVolume = 0;
    let residual = 0;
    let hazardous = 0;
    const generators = new Map();
    const monthMap = new Map();
    const companyTypeCounts = { LGU: 0, Private: 0 };
    const statusCounts = {};
    const cellCount = Number(
      facility.numberOfCell || facility.cellCapacities?.length || 0,
    );
    const cellUsed = Array(cellCount).fill(0);
    const tableRows = [];

    subs.forEach((sub) => {
      const status = sub.status || "pending";
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      const ct = sub.companyType === "Private" ? "Private" : "LGU";
      companyTypeCounts[ct] = (companyTypeCounts[ct] || 0) + 1;
      const gName = sub.lguCompanyName || "Unknown";
      const month = sub.dateOfDisposal
        ? dayjs(sub.dateOfDisposal).format("YYYY-MM")
        : sub.createdAt
          ? dayjs(sub.createdAt).format("YYYY-MM")
          : "Unknown";
      let subVolume = 0;
      (sub.trucks || []).forEach((truck) => {
        totalTrucks += 1;
        const placements = (truck.vehicles || []).filter(
          (v) => Number(v.actualVolume || 0) > 0,
        );
        const items = placements.length
          ? placements.map((v) => ({
              vol: v.actualVolume,
              vunit: v.actualVolumeUnit || truck.actualVolumeUnit,
              wt: v.wasteType || truck.wasteType,
              cellIndex: v.cellIndex,
            }))
          : [
              {
                vol: truck.actualVolume,
                vunit: truck.actualVolumeUnit,
                wt: truck.wasteType,
                cellIndex: truck.cellIndex,
              },
            ];
        items.forEach(({ vol, vunit, wt, cellIndex }) => {
          const v = convertVolume(vol, vunit || unit, unit);
          if (!v) return;
          totalVolume += v;
          subVolume += v;
          if (getWasteKind(wt) === "hazardous") hazardous += v;
          else residual += v;
          generators.set(gName, (generators.get(gName) || 0) + v);
          monthMap.set(month, (monthMap.get(month) || 0) + v);
          const idx = Number(cellIndex);
          if (Number.isInteger(idx) && idx >= 0 && idx < cellCount)
            cellUsed[idx] += v;
        });
      });
      tableRows.push({
        _id: sub._id,
        idNo: sub.idNo,
        dateOfDisposal: sub.dateOfDisposal,
        lguCompanyName: sub.lguCompanyName,
        companyType: sub.companyType,
        truckCount: (sub.trucks || []).length,
        volume: Math.round(subVolume),
        status,
      });
    });

    const cellData = Array.from({ length: cellCount }, (_, i) => {
      const capacity = convertVolume(
        facility.cellCapacities?.[i] || 0,
        facility.cellCapacityUnits?.[i] || unit,
        unit,
      );
      const base = convertVolume(
        facility.cellFillValues?.[i] || 0,
        facility.cellFillUnits?.[i] || unit,
        unit,
      );
      const used = Math.round(base + cellUsed[i]);
      return {
        name: `Cell ${i + 1}`,
        capacity: Math.round(capacity),
        used,
        type: facility.cellTypes?.[i] || "Residual",
        status: facility.cellStatuses?.[i] || "Active Cell",
        pct: capacity > 0 ? Math.min(100, (used / capacity) * 100) : null,
      };
    });

    const monthly = Array.from(monthMap.entries())
      .filter(([m]) => m !== "Unknown")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([m, v]) => ({ month: dayjs(`${m}-01`).format("MMM YY"), volume: Math.round(v) }));

    const topGenerators = Array.from(generators.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, v]) => ({
        name: name.length > 18 ? `${name.slice(0, 17)}…` : name,
        value: Math.round(v),
      }));

    const companyTypeData = Object.entries(companyTypeCounts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }));

    const statusData = Object.entries(statusCounts).map(([name, value]) => ({
      name: name.replace("_", " "),
      value,
    }));

    return {
      unit,
      totalSubmissions: subs.length,
      totalTrucks,
      totalVolume: Math.round(totalVolume),
      residual: Math.round(residual),
      hazardous: Math.round(hazardous),
      generatorCount: generators.size,
      companyTypeData,
      statusData,
      cellData,
      monthly,
      topGenerators,
      tableRows,
    };
  }, [detailViewRecord, detailModal, slfSubmissions]);

  const openDailySubmissionsModal = (cellRow) => {
    if (!detailViewRecord) return;
    const targetIndex =
      cellRow?.index != null ? cellRow.index : parseCellIndex(cellRow?.cellName);
    const fallbackIndex = targetIndex != null ? targetIndex : 0;
    const rows = slfSubmissions
      .filter(
        (submission) =>
          ACTIVE_VOLUME_STATUSES.has(submission.status || "pending") &&
          submissionMatchesFacility(detailViewRecord, submission),
      )
      .flatMap((submission) =>
        (submission.trucks || []).map((truck, truckIndex) => ({
          key: `${submission._id}-${truckIndex}`,
          submission,
          truck,
          truckIndex,
          cellIndex: getTruckCellIndex(truck),
        })),
      )
      .filter((item) => {
        if (!hasTruckVolume({ trucks: [item.truck] })) return false;
        const placedIndex = findBestCellIndex(
          detailViewRecord._cellUsageRows || [],
          item.truck?.wasteType,
          item.cellIndex,
        );
        return placedIndex === fallbackIndex;
      });
    setDailySubmissionsModal({ open: true, cell: cellRow, rows });
  };

  const generatorOptions = useMemo(
    () => generators.map((g) => ({ label: g.slfName, value: g._id })),
    [generators],
  );

  const toFileList = (arr) =>
    (arr || []).map((item, i) =>
      typeof item === "string"
        ? {
            uid: `existing-${i}`,
            name: item.split("/").pop() || item,
            status: "done",
            url: item,
          }
        : item,
    );

  const populateForm = (record) => {
    const receivingFacilities = record.receivingFacilities?.length
      ? record.receivingFacilities
      : (record.mrfDetails || []).map((item) => ({
          mrfTypes: item.type ? [item.type] : [],
          mrfName: item.name || "",
          status: item.status || "Active",
          description: item.notes || "",
        }));
    const dischargePermits = record.dischargePermits?.length
      ? record.dischargePermits
      : record.dischargePermit ||
          record.dischargePermitValidity ||
          record.dischargePermitStatus
        ? [
            {
              permitNo: record.dischargePermit,
              validity: record.dischargePermitValidity,
              status: record.dischargePermitStatus,
            },
          ]
        : [];
    const permitToOperatePermits = record.permitToOperatePermits?.length
      ? record.permitToOperatePermits
      : record.permitToOperate ||
          record.permitToOperateValidity ||
          record.permitToOperateStatus
        ? [
            {
              permitNo: record.permitToOperate,
              validity: record.permitToOperateValidity,
              status: record.permitToOperateStatus,
            },
          ]
        : [];
    form.setFieldsValue({
      ...record,
      cellCapacities: record.cellCapacities || [],
      cellCapacityUnits:
        record.cellCapacityUnits ||
        Array.from({ length: record.numberOfCell || 0 }, () => "m³"),
      cellStatuses: (
        record.cellStatuses ||
        Array.from({ length: record.numberOfCell || 0 }, () => "Active Cell")
      ).map(normalizeCellStatus),
      cellTypes:
        record.cellTypes ||
        Array.from({ length: record.numberOfCell || 0 }, () => "Residual"),
      cellSubmissionAllowed:
        record.cellSubmissionAllowed ||
        Array.from({ length: record.numberOfCell || 0 }, () => true),
      cellNotes:
        record.cellNotes ||
        Array.from({ length: record.numberOfCell || 0 }, () => ""),
      cellFillValues:
        record.cellFillValues ||
        Array.from({ length: record.numberOfCell || 0 }, () => null),
      cellFillUnits:
        record.cellFillUnits ||
        Array.from({ length: record.numberOfCell || 0 }, () => "m³"),
      lguServedList: record.lguServedList || [],
      privateCompaniesServed: record.privateCompaniesServed || [],
      volumeCapacityUnit: record.volumeCapacityUnit || "m³",
      receivingVolumeCapacityUnit: record.receivingVolumeCapacityUnit || "m³",
      wastewaterTreatmentFacilityType: asStringArray(record.wastewaterTreatmentFacilityType),
      wastewaterTreatmentFacilityRemarks: record.wastewaterTreatmentFacilityRemarks || "",
      receivingFacilities,
      leachatePondDetails: (record.leachatePondDetails || []).map((p) => ({
        ...p,
        attachments: toFileList(p.attachments),
      })),
      gasVentDetails: (record.gasVentDetails || []).map((v) => ({
        ...v,
        attachments: toFileList(v.attachments),
      })),
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
      wasteReceivedUnit: record.wasteReceivedUnit || "m³",
      estimatedVolumeWasteUnit: record.estimatedVolumeWasteUnit || "m³",
      dateReportApproved: record.dateReportApproved
        ? dayjs(record.dateReportApproved)
        : null,
      dischargePermitValidity: record.dischargePermitValidity
        ? dayjs(record.dischargePermitValidity)
        : null,
      permitToOperateValidity: record.permitToOperateValidity
        ? dayjs(record.permitToOperateValidity)
        : null,
      dischargePermits: dischargePermits.map((permit) => ({
        ...permit,
        validity: permit.validity ? dayjs(permit.validity) : null,
      })),
      permitToOperatePermits: permitToOperatePermits.map((permit) => ({
        ...permit,
        validity: permit.validity ? dayjs(permit.validity) : null,
      })),
      commitmentFiles: toFileList(record.commitmentFiles || []),
      progressReportFiles: toFileList(record.progressReportFiles || []),
      preventiveMeasureFiles: toFileList(record.preventiveMeasureFiles || []),
      scrpDetails: (record.scrpDetails || []).map((row) => ({
        ...row,
        attachments: toFileList(row.attachments),
      })),
      galleryPhotos: toFileList(record.galleryPhotos || []),
      galleryItems: (record.galleryItems || []).map((item, i) => ({
        ...item,
        folder: item.folder ? [item.folder] : [],
        url: item.url
          ? [
              {
                uid: `gallery-${i}`,
                name: item.url.split("/").pop() || "photo",
                status: "done",
                url: item.url,
              },
            ]
          : [],
      })),
      slfDocuments: (record.slfDocuments || []).map((d) => ({
        ...d,
        url: d.url
          ? [
              {
                uid: `doc-${d.url}`,
                name: d.url.split("/").pop() || d.title || "file",
                status: "done",
                url: d.url,
              },
            ]
          : [],
      })),
    });
  };

  const openAdd = () => {
    setEditing(null);
    setEditYear(new Date().getFullYear());
    setEditYearRecords([]);
    form.resetFields();
    form.setFieldsValue({
      volumeCapacityUnit: "m³",
      wasteReceivedUnit: "m³",
      estimatedVolumeWasteUnit: "m³",
      lguServedList: [],
      privateCompaniesServed: [],
      cellNotes: [],
      cellFillValues: [],
      cellCapacityUnits: [],
      cellFillUnits: [],
      dischargePermits: [],
      permitToOperatePermits: [],
      leachatePondDetails: [],
      gasVentDetails: [],
      receivingFacilities: [],
      wastewaterTreatmentFacilityType: [],
      wastewaterTreatmentFacilityRemarks: "",
      commitmentFiles: [],
      progressReportFiles: [],
      preventiveMeasureFiles: [],
      scrpDetails: [],
      galleryItems: [],
    });
    setModalOpen(true);
  };
  const openEdit = (record) => {
    const yr = record.dataYear || new Date().getFullYear();
    setEditing(record);
    setEditYear(yr);
    populateForm(record);
    // Fetch all year records for this LGU
    if (record.lgu) {
      api
        .get(`/slf-facilities/history/${encodeURIComponent(record.lgu)}`)
        .then(({ data }) => setEditYearRecords(data))
        .catch(() => setEditYearRecords([]));
    } else {
      setEditYearRecords([]);
    }
    setModalOpen(true);
  };

  const handleEditYearChange = (yr) => {
    setEditYear(yr);
    const match = editYearRecords.find(
      (r) => (r.dataYear || new Date().getFullYear()) === yr,
    );
    if (match) {
      setEditing(match);
      form.resetFields();
      populateForm(match);
    } else {
      // Blank record for this year — keep location fields from current editing
      const current = editing || {};
      setEditing({
        _id: null,
        lgu: current.lgu,
        province: current.province,
        barangay: current.barangay,
        latitude: current.latitude,
        longitude: current.longitude,
        eccNo: current.eccNo,
      });
      form.resetFields();
      form.setFieldsValue({
        province: current.province,
        lgu: current.lgu,
        barangay: current.barangay,
        latitude: current.latitude,
        longitude: current.longitude,
        eccNo: current.eccNo,
        volumeCapacityUnit: "m³",
        receivingVolumeCapacityUnit: "m³",
        wasteReceivedUnit: "m³",
        estimatedVolumeWasteUnit: "m³",
        lguServedList: [],
        privateCompaniesServed: [],
        cellNotes: [],
        cellFillValues: [],
        cellCapacityUnits: [],
        cellFillUnits: [],
        dischargePermits: [],
        permitToOperatePermits: [],
        leachatePondDetails: [],
        gasVentDetails: [],
        receivingFacilities: [],
        wastewaterTreatmentFacilityType: [],
        wastewaterTreatmentFacilityRemarks: "",
        commitmentFiles: [],
        progressReportFiles: [],
        preventiveMeasureFiles: [],
        scrpDetails: [],
        galleryItems: [],
      });
    }
  };

  const getActiveCellOptions = () => {
    const count = Number(form.getFieldValue("numberOfCell") || editing?.numberOfCell || 0);
    const statuses = form.getFieldValue("cellStatuses") || editing?.cellStatuses || [];
    const types = form.getFieldValue("cellTypes") || editing?.cellTypes || [];
    return Array.from({ length: count }, (_, index) => {
      const status = normalizeCellStatus(statuses[index]);
      return {
        index,
        label: `Cell ${index + 1} - ${types[index] || "Residual"} (${status})`,
        name: `Cell ${index + 1}`,
        type: types[index] || "Residual",
        status,
      };
    }).filter((cell) => isActiveCellStatus(cell.status));
  };

  const getEditingSubmissions = () => {
    const record = editing || {};
    return (slfSubmissions || [])
      .filter((submission) => submissionMatchesFacility(record, submission) && hasTruckVolume(submission))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  };

  const openCellAssignmentModal = () => {
    const submissions = getEditingSubmissions();
    setCellAssignmentModal({ submissions, selectedId: submissions[0]?._id || null });
  };

  const updateCellAssignmentLocal = (submissionId, truckIndex, cellIndex, vehicleIndex = null) => {
    const cell = getActiveCellOptions().find((item) => item.index === cellIndex);
    const cellPatch = {
      cellIndex,
      cellName: cell?.name || "",
      cellType: cell?.type || "",
    };
    setCellAssignmentModal((prev) => ({
      ...prev,
      submissions: (prev?.submissions || []).map((submission) => {
        if (submission._id !== submissionId) return submission;
        const trucks = (submission.trucks || []).map((truck, index) => {
          if (index !== truckIndex) return truck;
          if (Number.isInteger(vehicleIndex) && Array.isArray(truck.vehicles)) {
            const vehicles = truck.vehicles.map((veh, vIdx) =>
              vIdx === vehicleIndex ? { ...veh, ...cellPatch } : veh,
            );
            // keep truck-level synced with first vehicle
            const synced = vehicleIndex === 0 ? cellPatch : {};
            return { ...truck, ...synced, vehicles };
          }
          const vehicles = Array.isArray(truck.vehicles)
            ? truck.vehicles.map((veh) => ({ ...veh, ...cellPatch }))
            : truck.vehicles;
          return { ...truck, ...cellPatch, vehicles };
        });
        return { ...submission, trucks };
      }),
    }));
  };

  const saveCellAssignments = async () => {
    const submission = (cellAssignmentModal?.submissions || []).find(
      (item) => item._id === cellAssignmentModal.selectedId,
    );
    if (!submission) return;
    setCellAssignmentSaving(true);
    try {
      const assignments = [];
      (submission.trucks || []).forEach((truck, truckIndex) => {
        if (Array.isArray(truck.vehicles) && truck.vehicles.length > 0) {
          truck.vehicles.forEach((veh, vehicleIndex) => {
            assignments.push({
              truckIndex,
              vehicleIndex,
              cellIndex: veh.cellIndex,
              cellName: veh.cellName,
              cellType: veh.cellType,
            });
          });
        } else {
          assignments.push({
            truckIndex,
            cellIndex: truck.cellIndex,
            cellName: truck.cellName,
            cellType: truck.cellType,
          });
        }
      });
      const { data } = await api.patch(`/data-slf/${submission._id}/cell-assignments`, { assignments });
      const updated = data.data || submission;
      setSlfSubmissions((prev) => prev.map((item) => item._id === updated._id ? updated : item));
      setCellAssignmentModal((prev) => ({
        ...prev,
        submissions: (prev?.submissions || []).map((item) => item._id === updated._id ? updated : item),
      }));
      await fetchRecords(true);
      Swal.fire("Saved", "Submission waste placement was updated.", "success");
    } catch (error) {
      Swal.fire("Error", error.response?.data?.message || "Failed to update cell assignments", "error");
    } finally {
      setCellAssignmentSaving(false);
    }
  };

  const handleSave = async () => {
    if (!editYear) {
      Swal.fire(
        "Year Required",
        "Please select a year before saving.",
        "warning",
      );
      return;
    }
    let saved = false;
    const wasEditing = Boolean(editing?._id);
    setSaving(true);
    try {
      const values = await form.validateFields();
      const fromFileList = (fl) =>
        (fl || [])
          .filter((f) => f.status !== "error" && f.status !== "uploading")
          .map((f) =>
            typeof f === "string" ? f : f.response?.url || f.url || f.name || "",
          )
          .filter(Boolean);
      const existingRecord = editing || {};
      const fieldValue = (key, fallback) =>
        values[key] !== undefined ? values[key] : existingRecord[key] ?? fallback;
      const fileFieldValue = (key) =>
        values[key] !== undefined
          ? fromFileList(values[key])
          : existingRecord[key] || [];
      const dateFieldValue = (key) =>
        values[key] !== undefined
          ? values[key]?.toISOString?.() ?? null
          : existingRecord[key] || null;
      const existingLeachateDetails = existingRecord.leachatePondDetails || [];
      const existingGasVentDetails = existingRecord.gasVentDetails || [];
      const dischargePermits = fieldValue("dischargePermits", [])
        .map((permit) => ({
          ...permit,
          validity: permit.validity?.toISOString?.() ?? null,
        }))
        .filter(
          (permit) =>
            permit.permitNo ||
            permit.permitType ||
            permit.validity ||
            permit.status,
        );
      const permitToOperatePermits = fieldValue("permitToOperatePermits", [])
        .map((permit) => ({
          ...permit,
          validity: permit.validity?.toISOString?.() ?? null,
        }))
        .filter(
          (permit) => permit.permitNo || permit.validity || permit.status,
        );
      const receivingFacilities = fieldValue("receivingFacilities", [])
        .map((facility) => ({
          mrfTypes: facility.mrfTypes || [],
          mrfName: facility.mrfName || "",
          status: facility.status || "",
          description: facility.description || "",
        }))
        .filter(
          (facility) =>
            facility.mrfTypes.length ||
            facility.mrfName ||
            facility.status ||
            facility.description,
        );
      const hasWastewaterTreatmentFacility = fieldValue(
        "hasWastewaterTreatmentFacility",
        false,
      );
      const leachatePondDetails = fieldValue("leachatePondDetails", []).map((p, index) => ({
        ...p,
        wastewaterTreatmentFacilityType: asStringArray(p.wastewaterTreatmentFacilityType),
        attachments: p.attachments !== undefined
          ? fromFileList(p.attachments)
          : existingLeachateDetails[index]?.attachments || [],
      }));
      const gasVentDetails = fieldValue("gasVentDetails", []).map((v, index) => ({
        ...v,
        attachments: v.attachments !== undefined
          ? fromFileList(v.attachments)
          : existingGasVentDetails[index]?.attachments || [],
      }));
      const lguServedList = fieldValue("lguServedList", []);
      const privateCompaniesServed = fieldValue("privateCompaniesServed", []);
      const ownership = fieldValue("ownership", "");
      const payload = {
        ...values,
        dataYear: editYear,
        // Auto-compute noOfLGUServed from the multi-select lists
        noOfLGUServed: /private/i.test(ownership || "")
          ? privateCompaniesServed.length
          : lguServedList.length,
        lguServedList,
        privateCompaniesServed,
        cellStatuses: fieldValue("cellStatuses", []).map(normalizeCellStatus),
        cellCapacities: fieldValue("cellCapacities", []),
        cellCapacityUnits: fieldValue("cellCapacityUnits", []),
        cellTypes: fieldValue("cellTypes", []),
        cellSubmissionAllowed: fieldValue("cellSubmissionAllowed", []),
        cellNotes: fieldValue("cellNotes", []),
        cellFillValues: fieldValue("cellFillValues", []),
        cellFillUnits: fieldValue("cellFillUnits", []),
        hasWastewaterTreatmentFacility,
        wastewaterTreatmentFacilityType: hasWastewaterTreatmentFacility
          ? asStringArray(fieldValue("wastewaterTreatmentFacilityType", []))
          : [],
        wastewaterTreatmentFacilityRemarks: hasWastewaterTreatmentFacility
          ? fieldValue("wastewaterTreatmentFacilityRemarks", "") || ""
          : "",
        receivingFacilities,
        leachatePondDetails,
        gasVentDetails,
        dateOfMonitoring: dateFieldValue("dateOfMonitoring"),
        dateReportPrepared: dateFieldValue("dateReportPrepared"),
        dateReportReviewedStaff: dateFieldValue("dateReportReviewedStaff"),
        dateReportReviewedFocal: dateFieldValue("dateReportReviewedFocal"),
        noOfLeachatePond: leachatePondDetails.length,
        numberOfGasVents: gasVentDetails.length,
        dateReportApproved: dateFieldValue("dateReportApproved"),
        dischargePermits,
        dischargePermit: dischargePermits[0]?.permitNo || "",
        dischargePermitValidity: dischargePermits[0]?.validity || null,
        dischargePermitStatus: dischargePermits[0]?.status || "",
        permitToOperatePermits,
        permitToOperate: permitToOperatePermits[0]?.permitNo || "",
        permitToOperateValidity: permitToOperatePermits[0]?.validity || null,
        permitToOperateStatus: permitToOperatePermits[0]?.status || "",
        commitmentFiles: fileFieldValue("commitmentFiles"),
        progressReportFiles: fileFieldValue("progressReportFiles"),
        preventiveMeasureFiles: fileFieldValue("preventiveMeasureFiles"),
        scrpDetails: fieldValue("scrpDetails", [])
          .map((row) => ({
            ...row,
            attachments:
              row.attachments !== undefined
                ? fromFileList(row.attachments)
                : row.attachments || [],
          }))
          .filter(
            (row) =>
              row.planTitle ||
              row.status ||
              row.remarks ||
              row.attachments?.length,
          ),
        galleryPhotos: fileFieldValue("galleryPhotos"),
        galleryItems: fieldValue("galleryItems", [])
          .map((item) => ({
            ...item,
            url: Array.isArray(item.url)
              ? fromFileList(item.url)[0] || ""
              : item.url || "",
            folder: Array.isArray(item.folder)
              ? item.folder[0] || ""
              : item.folder || "",
          }))
          .filter(
            (item) => item.url || item.caption || item.folder || item.component,
          ),
        slfDocuments: fieldValue("slfDocuments", [])
          .map((d) => ({
            ...d,
            url: Array.isArray(d.url)
              ? fromFileList(d.url)[0] || ""
              : d.url || "",
          }))
          .filter((d) => d.title || d.url || d.description || d.docType),
      };
      Object.assign(payload, computeFields(payload));
      if (editing && editing._id) {
        const { data } = await api.put(
          `/slf-facilities/${editing._id}`,
          payload,
        );
        const updatedRecord = { ...data, ...computeFields(data) };
        setRecords((prev) => {
          const exists = prev.some((r) => r._id === data._id);
          if (exists)
            return prev.map((r) => (r._id === data._id ? updatedRecord : r));
          return [...prev, updatedRecord];
        });
        setEditYearRecords((prev) => {
          const exists = prev.some((r) => r._id === data._id);
          if (exists)
            return prev.map((r) => (r._id === data._id ? updatedRecord : r));
          return [...prev, updatedRecord];
        });
        setEditing(updatedRecord);
        setDetailModal((prev) => (prev?._id === data._id ? updatedRecord : prev));
        invalidateCache(CACHE_KEY);
        secureStorage.invalidateDashboard();
        Swal.fire(
          "Saved",
          `${payload.lgu || "SLF"} data records successfully saved!`,
          "success",
        );
        saved = true;
      } else {
        const { data } = await api.post("/slf-facilities", payload);
        const createdRecord = { ...data, ...computeFields(data) };
        setRecords((prev) => [...prev, createdRecord]);
        setEditYearRecords((prev) => [...prev, createdRecord]);
        setEditing(createdRecord);
        invalidateCache(CACHE_KEY);
        secureStorage.invalidateDashboard();
        Swal.fire(
          "Saved",
          `${payload.lgu || "SLF"} data records successfully saved!`,
          "success",
        );
        saved = true;
      }
    } catch (err) {
      if (err.errorFields?.length) {
        Swal.fire(
          "Missing or Invalid Fields",
          err.errorFields[0]?.errors?.[0] || "Please check the highlighted fields before saving.",
          "warning",
        );
      } else if (err.response) {
        Swal.fire(
          "Error",
          err.response.data?.message || "Save failed",
          "error",
        );
      } else {
        Swal.fire("Error", err.message || "Save failed", "error");
      }
    }
    setSaving(false);
    if (!saved) return;
    if (!wasEditing) {
      setModalOpen(false);
      setConvArea(null);
      setConvDepth(null);
      setConvVol(null);
      setConvDensity(0.2);
      setConvM3ToTons(null);
      setConvModalOpen(false);
      setUnitToolOpen(false);
    }
  };

  const syncWasteReceivedFromCellFills = (nextFills, nextUnits) => {
    const units = nextUnits || form.getFieldValue("cellFillUnits") || [];
    const targetUnit = normalizeUnit(
      form.getFieldValue("wasteReceivedUnit") || units.find(Boolean) || "m³",
    );
    const total = (nextFills || []).reduce(
      (sum, value, index) =>
        sum + convertVolume(value, units[index] || targetUnit, targetUnit),
      0,
    );
    form.setFieldsValue({
      actualResidualWasteReceived: Number(total.toFixed(3)),
      wasteReceivedUnit: targetUnit,
    });
  };

  const handleCellFillValueChange = (index, value) => {
    const nextFills = [...(form.getFieldValue("cellFillValues") || [])];
    nextFills[index] = value;
    form.setFieldsValue({ cellFillValues: nextFills });
    syncWasteReceivedFromCellFills(nextFills);
  };

  const handleCellCapacityUnitChange = (index, value) => {
    const unit = normalizeUnit(value);
    const nextCapacityUnits = [...(form.getFieldValue("cellCapacityUnits") || [])];
    const nextFillUnits = [...(form.getFieldValue("cellFillUnits") || [])];
    nextCapacityUnits[index] = unit;
    nextFillUnits[index] = unit;
    form.setFieldsValue({
      cellCapacityUnits: nextCapacityUnits,
      cellFillUnits: nextFillUnits,
      volumeCapacityUnit: unit,
      receivingVolumeCapacityUnit: unit,
      wasteReceivedUnit: unit,
    });
    syncWasteReceivedFromCellFills(
      form.getFieldValue("cellFillValues") || [],
      nextFillUnits,
    );
  };

  const handleCellFillUnitChange = (index, value) => {
    const nextUnits = [...(form.getFieldValue("cellFillUnits") || [])];
    const unit = normalizeUnit(value);
    nextUnits[index] = unit;
    form.setFieldsValue({ cellFillUnits: nextUnits, wasteReceivedUnit: unit });
    syncWasteReceivedFromCellFills(
      form.getFieldValue("cellFillValues") || [],
      nextUnits,
    );
  };

  const openMapPreview = () => {
    const latitude = form.getFieldValue("latitude");
    const longitude = form.getFieldValue("longitude");
    if (
      latitude == null ||
      longitude == null ||
      Number.isNaN(Number(latitude)) ||
      Number.isNaN(Number(longitude))
    ) {
      message.warning("Enter valid latitude and longitude first.");
      return;
    }
    setMapPreview({
      latitude: Number(latitude),
      longitude: Number(longitude),
      label: form.getFieldValue("lgu") || editing?.lgu || "SLF Location",
    });
  };

  const sendCapacityAlert = async () => {
    if (!capacityAlertModal?.record?._id || !capacityAlertModal?.cell) return;
    setCapacityAlertSending(true);
    try {
      const { record, cell, message: customMessage } = capacityAlertModal;
      const { data } = await api.post(
        `/slf-facilities/${record._id}/cell-capacity-alert`,
        {
          cellIndex: cell.index,
          percent: cell.pct,
          threshold: 80,
          message:
            customMessage ||
            `${record.lgu || "Assigned SLF"} Cell ${cell.index + 1} is ${cell.pct}% full. Please review disposal planning and available cell capacity.`,
        },
      );
      Swal.fire(
        "Notification Sent",
        `${data?.notified || 0} assigned portal user(s) notified.`,
        "success",
      );
      setCapacityAlertModal(null);
    } catch (err) {
      Swal.fire(
        "Error",
        err.response?.data?.message || "Failed to send cell capacity alert.",
        "error",
      );
    } finally {
      setCapacityAlertSending(false);
    }
  };

  const applyUnitTool = () => {
    const unit = normalizeUnit(unitToolValue || "m³");
    const cellCount = Math.max(
      Number(form.getFieldValue("numberOfCell") || 0),
      (form.getFieldValue("cellCapacities") || []).length,
      (form.getFieldValue("cellFillValues") || []).length,
    );
    form.setFieldsValue({
      volumeCapacityUnit: unit,
      receivingVolumeCapacityUnit: unit,
      wasteReceivedUnit: unit,
      estimatedVolumeWasteUnit: unit,
      cellCapacityUnits: Array.from({ length: cellCount }, () => unit),
      cellFillUnits: Array.from({ length: cellCount }, () => unit),
    });
    message.success(`Units set to ${unit}`);
    setUnitToolOpen(false);
  };

  const copyText = async (value, label = "Value") => {
    const text = String(value ?? "");
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      message.success(`${label} copied`);
    } catch {
      message.error("Copy failed. Please select and copy the value manually.");
    }
  };

  const reviewAndDeleteRecord = async (record) => {
    const reviewHtml = `
      <div style="text-align:left;font-size:13px;line-height:1.7;">
        <div><strong>LGU:</strong> ${record.lgu || "N/A"}</div>
        <div><strong>Province:</strong> ${record.province || "N/A"}</div>
        <div><strong>Data Year:</strong> ${record.dataYear || "N/A"}</div>
        <div><strong>Status:</strong> ${record.statusOfSLF || "N/A"}</div>
        <div><strong>Category:</strong> ${record.category || "N/A"}</div>
      </div>
    `;

    const result = await Swal.fire({
      icon: "warning",
      title: "Review Before Deletion",
      html: `${reviewHtml}<p style="margin-top:12px;">This record will be moved to Deleted SLF Data in Developer Settings.</p>`,
      showCancelButton: true,
      confirmButtonText: "Move to Trash",
      confirmButtonColor: "#ff4d4f",
      cancelButtonText: "Cancel",
    });

    if (!result.isConfirmed) return;

    try {
      await api.delete(`/slf-facilities/${record._id}`);
      setRecords((prev) => prev.filter((r) => r._id !== record._id));
      invalidateCache(CACHE_KEY);
      secureStorage.invalidateDashboard();
      Swal.fire({
        icon: "success",
        title: "Moved to Trash",
        timer: 1100,
        showConfirmButton: false,
      });
    } catch {
      Swal.fire("Error", "Failed to delete record", "error");
    }
  };

  // Available years from data — kept for edit/detail modals (year navigation)
  const availableYears = useMemo(() => {
    const cy = new Date().getFullYear();
    const years = [
      ...new Set([cy, cy - 1, ...records.map((r) => r.dataYear || cy)]),
    ];
    return years.sort((a, b) => b - a);
  }, [records]);

  const filtered = useMemo(() => {
    let data = records;
    if (searchText) data = data.filter((r) => rowMatchesSearch(r, searchText));
    if (filterProvince)
      data = data.filter((r) => matchesFilter(r.province, filterProvince));
    if (filterStatus) data = data.filter((r) => matchesFilter(r.statusOfSLF, filterStatus));
    if (filterCategory)
      data = data.filter((r) => matchesFilter(r.category, filterCategory));
    if (filterMonth) data = data.filter((r) => matchesFilter(r.targetMonth, filterMonth));

    if (quickFilter === "operational") {
      data = data.filter(
        (r) =>
          /operational/i.test(r.statusOfSLF || "") &&
          !/non/i.test(r.statusOfSLF || ""),
      );
    }
    if (quickFilter === "withCells") {
      data = data.filter((r) => Number(r.numberOfCell || 0) > 0);
    }
    if (quickFilter === "withLGUs") {
      data = data.filter((r) => Number(r.noOfLGUServed || 0) > 0);
    }
    if (quickFilter === "private") {
      data = data.filter((r) => /private/i.test(r.ownership || ""));
    }
    if (quickFilter === "withCapacity") {
      data = data.filter((r) => Number(r.volumeCapacity || 0) > 0);
    }
    if (quickFilter === "withWaste") {
      data = data.filter((r) => Number(r.actualResidualWasteReceived || 0) > 0);
    }
    if (quickFilter === "withLeachate") {
      data = data.filter((r) => Number(r.noOfLeachatePond || 0) > 0);
    }
    if (quickFilter === "withGas") {
      data = data.filter((r) => Number(r.numberOfGasVents || 0) > 0);
    }

    // Deduplicate by LGU — keep only the latest dataYear record per facility
    const map = new Map();
    for (const r of data) {
      const key = [r.province, r.lgu, r.barangay]
        .filter(Boolean)
        .join("|")
        .toLowerCase() || r._id;
      const existing = map.get(key);
      if (!existing || (r.dataYear || 0) > (existing.dataYear || 0)) {
        map.set(key, r);
      }
    }
    return [...map.values()];
  }, [
    records,
    searchText,
    filterProvince,
    filterStatus,
    filterCategory,
    filterMonth,
    quickFilter,
  ]);

  const hasFilters =
    searchText ||
    filterProvince ||
    filterStatus ||
    filterCategory ||
    filterMonth ||
    quickFilter;
  const clearFilters = () => {
    setSearchText("");
    setFilterProvince(null);
    setFilterStatus(null);
    setFilterCategory(null);
    setFilterMonth(null);
    setQuickFilter(null);
  };

  // Summary tiles
  const totalRecords = filtered.length;
  const opCount = filtered.filter(
    (r) => /operational/i.test(r.statusOfSLF) && !/non/i.test(r.statusOfSLF),
  ).length;
  const nonOpCount = filtered.filter((r) => /non/i.test(r.statusOfSLF)).length;
  const totalCapacity = filtered.reduce(
    (s, r) => s + (r.volumeCapacity || 0),
    0,
  );
  const totalLGUs = filtered.reduce((s, r) => s + (r.noOfLGUServed || 0), 0);
  const totalCells = filtered.reduce((s, r) => s + (r.numberOfCell || 0), 0);
  const totalLeachate = filtered.reduce(
    (s, r) => s + (r.noOfLeachatePond || 0),
    0,
  );
  const totalGasVents = filtered.reduce(
    (s, r) => s + (r.numberOfGasVents || 0),
    0,
  );
  const totalWaste = filtered.reduce(
    (s, r) => s + (r.actualResidualWasteReceived || 0),
    0,
  );
  const wasteUnitLabel =
    filtered.some((r) => normalizeUnit(r.wasteReceivedUnit) === "tons") &&
    !filtered.some((r) => normalizeUnit(r.wasteReceivedUnit) === "m³")
      ? "tons"
      : "m³";
  const privateSectorCount = filtered.filter((r) =>
    /private/i.test(r.ownership),
  ).length;

  // Denominators — counts of records that have a value for each metric
  const cellsWithData = filtered.filter((r) => r.numberOfCell > 0).length;
  const lgusWithData = filtered.filter((r) => r.noOfLGUServed > 0).length;
  const capacityWithData = filtered.filter((r) => r.volumeCapacity > 0).length;
  const wasteWithData = filtered.filter(
    (r) => r.actualResidualWasteReceived > 0,
  ).length;
  const leachateWithData = filtered.filter(
    (r) => r.noOfLeachatePond > 0,
  ).length;
  const gasVentsWithData = filtered.filter(
    (r) => r.numberOfGasVents > 0,
  ).length;
  const privateWithData = filtered.filter((r) =>
    /private/i.test(r.ownership),
  ).length;
  const privateClientsTotal = sumBy(
    filtered,
    (r) => (r.privateCompaniesServed || []).length,
  );
  const receivingCapacityTotal = sumBy(
    filtered,
    (r) => r.receivingVolumeCapacity || 0,
  );
  const region3LguServed = sumBy(
    filtered.filter((r) => R3_PROVINCES.includes(r.province)),
    (r) => r.noOfLGUServed || 0,
  );
  const outsideRegionLguServed = Math.max(0, totalLGUs - region3LguServed);
  const capacityUsePercent =
    totalCapacity > 0 ? Math.min(100, (totalWaste / totalCapacity) * 100) : 0;
  const cellStatusSummary = filtered.reduce((acc, record) => {
    const cellCount = Number(record.numberOfCell || 0);
    const statuses = record.cellStatuses || [];
    if (statuses.length > 0) {
      statuses.slice(0, cellCount || statuses.length).forEach((status) => {
        const key = status || "Unspecified";
        acc[key] = (acc[key] || 0) + 1;
      });
    } else if (cellCount > 0) {
      acc.Recorded = (acc.Recorded || 0) + cellCount;
    }
    return acc;
  }, {});
  const leachateStatusSummary = filtered.reduce((acc, record) => {
    const ponds = record.leachatePondDetails || [];
    if (ponds.length > 0) {
      ponds.forEach((pond) => {
        const key = pond.status || "Active";
        acc[key] = (acc[key] || 0) + 1;
      });
    } else if (Number(record.noOfLeachatePond || 0) > 0) {
      acc.Recorded = (acc.Recorded || 0) + Number(record.noOfLeachatePond || 0);
    }
    return acc;
  }, {});
  const gasStatusSummary = filtered.reduce((acc, record) => {
    const vents = record.gasVentDetails || [];
    if (vents.length > 0) {
      vents.forEach((vent) => {
        const key = vent.status || "Active";
        acc[key] = (acc[key] || 0) + 1;
      });
    } else if (Number(record.numberOfGasVents || 0) > 0) {
      acc.Recorded = (acc.Recorded || 0) + Number(record.numberOfGasVents || 0);
    }
    return acc;
  }, {});

  const insightConfig = useMemo(() => {
    const ownershipBreakdown = groupMetric(
      filtered,
      (r) => r.ownership,
      () => 1,
    );
    const statusBreakdown = groupMetric(
      filtered,
      (r) => r.statusOfSLF,
      () => 1,
    );
    const categoryCapacity = groupMetric(
      filtered,
      (r) => r.category,
      (r) => r.volumeCapacity || 0,
    );
    const provinceCapacity = groupMetric(
      filtered,
      (r) => r.province,
      (r) => r.volumeCapacity || 0,
    );
    const provinceWaste = groupMetric(
      filtered,
      (r) => r.province,
      (r) => r.actualResidualWasteReceived || 0,
    );
    const lguData = topMetric(
      filtered,
      (r) => r.noOfLGUServed || 0,
      "LGUs served",
    );
    const cellData = topMetric(filtered, (r) => r.numberOfCell || 0, "cells");
    const privateData = filtered
      .map((record) => ({
        name: record.lgu || record.facilityName || "Unspecified SLF",
        province: record.province || "-",
        status: record.statusOfSLF || "-",
        ownership: record.ownership || "-",
        value:
          (record.privateCompaniesServed || []).length ||
          (/private/i.test(record.ownership || "") ? 1 : 0),
        label: "private sector served",
      }))
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value);
    const leachateData = topMetric(
      filtered,
      (r) => r.noOfLeachatePond || 0,
      "ponds",
    );
    const gasData = topMetric(
      filtered,
      (r) => r.numberOfGasVents || 0,
      "vents",
    );
    const wasteData = topMetric(
      filtered,
      (r) => r.actualResidualWasteReceived || 0,
      "received",
    );
    const capacityData = topMetric(
      filtered,
      (r) => r.volumeCapacity || 0,
      "capacity",
    );
    const statusToChart = (summary) =>
      Object.entries(summary)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

    return {
      cells: {
        title: "Cell Infrastructure Management",
        icon: <ExperimentOutlined style={{ color: "#13c2c2" }} />,
        color: "#13c2c2",
        primary: totalCells,
        primaryTitle: "Total Cells",
        stats: [
          { title: "Facilities with Cells", value: cellsWithData },
          {
            title: "Avg Cells / SLF",
            value: cellsWithData ? (totalCells / cellsWithData).toFixed(1) : 0,
          },
          { title: "Operational SLFs", value: opCount },
        ],
        chartData: cellData.slice(0, 10),
        pieData: statusToChart(cellStatusSummary),
        narration: `${cellsWithData} of ${totalRecords} SLFs have encoded cell infrastructure. The portfolio records ${totalCells.toLocaleString()} cells, with status mix shown below for operational planning and follow-up.`,
      },
      lgu: {
        title: "LGUs Served",
        icon: <TeamOutlined style={{ color: "#fa8c16" }} />,
        color: "#fa8c16",
        primary: totalLGUs,
        primaryTitle: "Total LGUs Served",
        stats: [
          { title: "Reporting SLFs", value: lgusWithData },
          { title: "Within Region 3", value: region3LguServed },
          { title: "Outside Region 3", value: outsideRegionLguServed },
        ],
        chartData: lguData.slice(0, 10),
        pieData: [
          { name: "Within Region 3", value: region3LguServed },
          { name: "Outside Region 3", value: outsideRegionLguServed },
        ].filter((item) => item.value > 0),
        narration: `${lgusWithData} SLFs report LGU coverage. Region 3 accounts for ${region3LguServed.toLocaleString()} served LGUs, while ${outsideRegionLguServed.toLocaleString()} are tagged outside Region 3 or without a Region 3 province match.`,
      },
      private: {
        title: "Private Sector Served",
        icon: <BankOutlined style={{ color: "#722ed1" }} />,
        color: "#722ed1",
        primary: privateClientsTotal || privateSectorCount,
        primaryTitle: privateClientsTotal ? "Private Clients" : "Private SLFs",
        stats: [
          { title: "Private-Owned SLFs", value: privateSectorCount },
          { title: "Client Records", value: privateClientsTotal },
          { title: "Reporting SLFs", value: privateWithData },
        ],
        chartData: privateData.slice(0, 10),
        pieData: ownershipBreakdown,
        narration: privateClientsTotal
          ? `${privateClientsTotal.toLocaleString()} private sector client records are attached to SLF facilities. Use the ranking to spot facilities serving the largest private client groups.`
          : `${privateSectorCount.toLocaleString()} facilities are tagged as private-owned. Client-level lists are not yet encoded for all records, so ownership is used as the current private sector signal.`,
      },
      gas: {
        title: "Gas Management",
        icon: <ExperimentOutlined style={{ color: "#52c41a" }} />,
        color: "#52c41a",
        primary: totalGasVents,
        primaryTitle: "Gas Management Records",
        stats: [
          { title: "SLFs with Gas Management", value: gasVentsWithData },
          {
            title: "Avg Records / SLF",
            value: gasVentsWithData
              ? (totalGasVents / gasVentsWithData).toFixed(1)
              : 0,
          },
          { title: "Operational SLFs", value: opCount },
        ],
        chartData: gasData.slice(0, 10),
        pieData: statusToChart(gasStatusSummary),
        narration: `${gasVentsWithData} SLFs report gas management infrastructure. The status breakdown highlights vents that are active, under maintenance, decommissioned, or only recorded at count level.`,
      },
      leachate: {
        title: "Leachate Management",
        icon: <AlertOutlined style={{ color: "#1890ff" }} />,
        color: "#1890ff",
        primary: totalLeachate,
        primaryTitle: "Leachate Treatment Plant",
        stats: [
          { title: "SLFs with Ponds", value: leachateWithData },
          {
            title: "Avg Ponds / SLF",
            value: leachateWithData
              ? (totalLeachate / leachateWithData).toFixed(1)
              : 0,
          },
          { title: "Non-Operational SLFs", value: nonOpCount },
        ],
        chartData: leachateData.slice(0, 10),
        pieData: statusToChart(leachateStatusSummary),
        narration: `${leachateWithData} SLFs have leachate pond records. Facilities with higher pond counts may need closer review of pond condition notes, maintenance status, and supporting attachments.`,
      },
      waste: {
        title: "Waste Received",
        icon: <BarChartOutlined style={{ color: "#ff4d4f" }} />,
        color: "#ff4d4f",
        primary: totalWaste,
        primaryTitle: "Waste Received",
        primarySuffix: filtered.some(
          (r) => normalizeUnit(r.wasteReceivedUnit) === "tons",
        )
          ? "tons"
          : "m³",
        stats: [
          { title: "Reporting SLFs", value: wasteWithData },
          {
            title: "Avg / Facility",
            value: wasteWithData ? Math.round(totalWaste / wasteWithData) : 0,
            suffix: filtered.some(
              (r) => normalizeUnit(r.wasteReceivedUnit) === "tons",
            )
              ? "tons"
              : "m³",
          },
          {
            title: "Capacity Use",
            value: capacityUsePercent.toFixed(1),
            suffix: "%",
          },
        ],
        chartData: wasteData.slice(0, 10),
        pieData: provinceWaste.slice(0, 8),
        narration: `${wasteWithData} SLFs report waste received. The total follows the latest portal baseline active-cell entries where available and is ${totalWaste.toLocaleString()}, equivalent to ${capacityUsePercent.toFixed(1)}% of encoded total capacity where comparable.`,
      },
      capacity: {
        title: "SLF Total Capacities",
        icon: <DatabaseOutlined style={{ color: "#eb2f96" }} />,
        color: "#eb2f96",
        primary: totalCapacity,
        primaryTitle: "Total Capacity",
        stats: [
          { title: "Facilities with Data", value: capacityWithData },
          { title: "Receiving Capacity", value: receivingCapacityTotal },
          {
            title: "Capacity Used",
            value: capacityUsePercent.toFixed(1),
            suffix: "%",
          },
        ],
        chartData: capacityData.slice(0, 10),
        pieData: categoryCapacity.length
          ? categoryCapacity
          : provinceCapacity.slice(0, 8),
        narration: `${capacityWithData} SLFs have encoded capacity. The encoded total is ${totalCapacity.toLocaleString()}, with ${receivingCapacityTotal.toLocaleString()} recorded as receiving volume capacity and ${capacityUsePercent.toFixed(1)}% represented by waste received.`,
      },
    };
  }, [
    capacityUsePercent,
    capacityWithData,
    cellStatusSummary,
    cellsWithData,
    filtered,
    gasStatusSummary,
    gasVentsWithData,
    leachateStatusSummary,
    leachateWithData,
    lgusWithData,
    nonOpCount,
    opCount,
    outsideRegionLguServed,
    privateClientsTotal,
    privateSectorCount,
    privateWithData,
    receivingCapacityTotal,
    region3LguServed,
    totalCapacity,
    totalCells,
    totalGasVents,
    totalLGUs,
    totalLeachate,
    totalRecords,
    totalWaste,
    wasteWithData,
  ]);

  const renderInsightModal = () => {
    const config = insightConfig[slfInsightModal];
    if (!config) return null;
    const maxBar = Math.max(...config.chartData.map((item) => item.value), 1);
    return (
      <Modal
        open={!!slfInsightModal}
        onCancel={() => setSlfInsightModal(null)}
        title={
          <Space>
            {config.icon}
            <Text strong>{config.title}</Text>
          </Space>
        }
        footer={<Button onClick={() => setSlfInsightModal(null)}>Close</Button>}
        width={1120}
        destroyOnHidden
      >
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          <Col xs={24} md={6}>
            <InsightStat
              title={config.primaryTitle}
              value={config.primary}
              suffix={config.primarySuffix}
              color={config.color}
            />
          </Col>
          {config.stats.map((stat) => (
            <Col xs={24} md={6} key={stat.title}>
              <InsightStat
                title={stat.title}
                value={stat.value}
                suffix={stat.suffix}
                color={config.color}
              />
            </Col>
          ))}
        </Row>

        <Alert
          type="info"
          showIcon
          message="Operational Narrative"
          description={config.narration}
          style={{ marginBottom: 16, borderRadius: 8 }}
        />

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={15}>
            <Card
              size="small"
              title="Facility Ranking"
              style={{ borderRadius: 8, height: "100%" }}
            >
              {config.chartData.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No encoded data for this metric"
                />
              ) : (
                <Space direction="vertical" size={10} style={{ width: "100%" }}>
                  {config.chartData.map((item, index) => (
                    <div key={`${item.name}-${index}`}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          marginBottom: 4,
                        }}
                      >
                        <Text strong style={{ fontSize: 12 }}>
                          {index + 1}. {item.name}
                        </Text>
                        <Text style={{ fontSize: 12, color: config.color }}>
                          {Number(item.value).toLocaleString()} {item.label}
                        </Text>
                      </div>
                      <Progress
                        percent={Math.round((item.value / maxBar) * 100)}
                        showInfo={false}
                        strokeColor={config.color}
                        trailColor="#f0f0f0"
                        size="small"
                      />
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {item.province} - {item.ownership} - {item.status}
                      </Text>
                    </div>
                  ))}
                </Space>
              )}
            </Card>
          </Col>
          <Col xs={24} lg={9}>
            <Card
              size="small"
              title="Breakdown"
              style={{ borderRadius: 8, height: "100%" }}
            >
              {config.pieData.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No breakdown data"
                />
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={210}>
                    <PieChart>
                      <Pie
                        data={config.pieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={48}
                        outerRadius={78}
                        paddingAngle={2}
                      >
                        {config.pieData.map((_, index) => (
                          <RCell
                            key={`slice-${index}`}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <RTooltip
                        formatter={(value, name) => [
                          Number(value).toLocaleString(),
                          name,
                        ]}
                      />
                      <Legend
                        verticalAlign="bottom"
                        height={40}
                        wrapperStyle={{ fontSize: 11 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <Space size={[6, 6]} wrap>
                    {config.pieData.slice(0, 8).map((item, index) => (
                      <Tag
                        key={item.name}
                        color={index % 2 === 0 ? "blue" : "geekblue"}
                      >
                        {item.name}: {Number(item.value).toLocaleString()}
                      </Tag>
                    ))}
                  </Space>
                </>
              )}
            </Card>
          </Col>
        </Row>
      </Modal>
    );
  };

  // Category descriptions
  const CATEGORY_DESC = {
    "Cat 1": "< 15 TPD",
    "Cat 2": "15–75 TPD",
    "Cat 3": "75–150 TPD",
    "Cat 4": "> 150 TPD",
  };

  const getCategoryLabel = (value) => {
    const match = String(value || "").match(/^cat\s*(\d+)$/i);
    return match ? `Category ${match[1]}` : value;
  };

  const columns = [
    {
      title: "#",
      key: "idx",
      width: 40,
      render: (_, __, i) => i + 1,
    },
    {
      title: "LGU",
      key: "lgu",
      width: 150,
      filters: buildFilters(records, "province"),
      onFilter: (v, r) => matchesFilter(r.province, v),
      sorter: (a, b) => (a.lgu || "").localeCompare(b.lgu || ""),
      render: (_, r) => (
        <Tooltip
          title={`${r.province} — ${r.lgu}${r.barangay ? ` (${r.barangay})` : ""}`}
        >
          <div style={{ lineHeight: 1.3 }}>
            <Text strong style={{ fontSize: 12 }}>
              {r.lgu}
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
      title: "Ownership",
      dataIndex: "ownership",
      width: 110,
      align: "center",
      filters: buildFilters(records, "ownership"),
      onFilter: (v, r) => matchesFilter(r.ownership, v),
    },
    {
      title: "Category",
      dataIndex: "category",
      width: 100,
      render: (v) =>
        v ? (
          <Tooltip title={CATEGORY_DESC[v] || v}>
            <div
              style={{
                maxWidth: "100%",
                whiteSpace: "normal",
                wordBreak: "break-word",
                lineHeight: 1.25,
              }}
            >
              <Tag
                color="blue"
                bordered={false}
                style={{
                  marginInlineEnd: 0,
                  maxWidth: "100%",
                  whiteSpace: "normal",
                  wordBreak: "break-word",
                  lineHeight: 1.3,
                  padding: "2px 6px",
                }}
              >
                {getCategoryLabel(v)}
                {CATEGORY_DESC[v] ? ` - ${CATEGORY_DESC[v]}` : ""}
              </Tag>
            </div>
          </Tooltip>
        ) : (
          "—"
        ),
      filters: buildFilters(records, "category"),
      onFilter: (v, r) => matchesFilter(r.category, v),
    },
    {
      title: "Status",
      key: "status",
      width: 140,
      filters: buildFilters(records, "statusOfSLF"),
      onFilter: (v, r) => matchesFilter(r.statusOfSLF, v),
      sorter: (a, b) =>
        (a.statusOfSLF || "").localeCompare(b.statusOfSLF || ""),
      render: (_, r) => (
        <div style={{ lineHeight: 1.3 }}>
          {getStatusTag(r.statusOfSLF)}
          {r.yearStartedOperation && (
            <div>
              <Text type="secondary" style={{ fontSize: 10 }}>
                <CalendarOutlined style={{ marginRight: 3 }} />
                Since {r.yearStartedOperation}
              </Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: "Capacity per day",
      key: "capacityPerDay",
      width: 110,
      sorter: (a, b) =>
        (a.receivingVolumeCapacity ?? a.volumeCapacity ?? 0) -
        (b.receivingVolumeCapacity ?? b.volumeCapacity ?? 0),
      render: (_, r) => {
        const value = r.receivingVolumeCapacity ?? r.volumeCapacity;
        const unit = normalizeUnit(
          r.receivingVolumeCapacity != null
            ? r.receivingVolumeCapacityUnit || r.volumeCapacityUnit || "m³"
            : r.volumeCapacityUnit || "m³",
        );
        return value != null ? (
          <div style={{ lineHeight: 1.25 }}>
            <Text strong style={{ color: ACCENT }}>
              {Number(value).toLocaleString()}
            </Text>
            <br />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {unit}/day
            </Text>
          </div>
        ) : (
          "—"
        );
      },
    },
    {
      title: "LGUs Served",
      dataIndex: "noOfLGUServed",
      width: 100,
      sorter: (a, b) => (a.noOfLGUServed || 0) - (b.noOfLGUServed || 0),
    },
    {
      title: "Cells",
      dataIndex: "numberOfCell",
      width: 80,
    },
    {
      title: "Leachate & Gas Management",
      key: "managementSummary",
      width: 170,
      render: (_, r) => {
        const leachateCount =
          Number(r.noOfLeachatePond || 0) || (r.leachatePondDetails || []).length;
        const gasCount =
          Number(r.numberOfGasVents || 0) || (r.gasVentDetails || []).length;
        const tooltip = [
          leachateCount
            ? `Leachate\n${managementStatusSummary(r.leachatePondDetails || []) || `${leachateCount} recorded`}`
            : "No leachate treatment plant recorded",
          gasCount
            ? `Gas Management\n${managementStatusSummary(r.gasVentDetails || []) || `${gasCount} recorded`}`
            : "No gas management details recorded",
        ].join("\n\n");
        return (
          <Tooltip title={<pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{tooltip}</pre>}>
            <Space direction="vertical" size={2}>
              <Text style={{ fontSize: 12 }}>
                <AlertOutlined style={{ color: "#fa8c16", marginRight: 4 }} />
                Leachate <Tag color={leachateCount ? "orange" : "default"}>{leachateCount || 0}</Tag>
              </Text>
              <Text style={{ fontSize: 12 }}>
                <ExperimentOutlined style={{ color: "#13c2c2", marginRight: 4 }} />
                Gas <Tag color={gasCount ? "cyan" : "default"}>{gasCount || 0}</Tag>
              </Text>
            </Space>
          </Tooltip>
        );
      },
    },
    {
      title: "Waste Received",
      dataIndex: "actualResidualWasteReceived",
      width: 110,
      sorter: (a, b) =>
        (a.actualResidualWasteReceived || 0) -
        (b.actualResidualWasteReceived || 0),
      render: (v, record) =>
        v != null
          ? `${Number(v).toLocaleString()} ${normalizeUnit(record.wasteReceivedUnit || "m³")}`
          : "—",
    },
    {
      title: "Target Month",
      dataIndex: "targetMonth",
      key: "targetMonth",
      width: 150,
      align: "center",
      ellipsis: false,
      filters: buildFilters(records, "targetMonth"),
      onFilter: (v, r) => matchesFilter(r.targetMonth, v),
      render: (v) =>
        v ? (
          <div style={{ whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.25 }}>
            <Tag
              bordered={false}
              color="cyan"
              style={{ whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.3 }}
            >
              {v.replace(/^\d+\./, "")}
            </Tag>
          </div>
        ) : (
          "—"
        ),
    },
    {
      title: "Personnel",
      key: "personnel",
      width: 170,
      ellipsis: false,
      render: (_, r) => (
        <Tooltip
          title={
            <div>
              <div>
                <UserOutlined /> ENMO: {r.enmo || "—"}
              </div>
              <div>
                <UserOutlined /> Focal: {r.focalPerson || "—"}
              </div>
            </div>
          }
        >
          <div
            style={{
              lineHeight: 1.3,
              whiteSpace: "normal",
              wordBreak: "break-word",
            }}
          >
            <Text style={{ fontSize: 11 }}>
              <UserOutlined style={{ color: "#722ed1", marginRight: 4 }} />
              {r.focalPerson || "—"}
            </Text>
            <br />
            <Text type="secondary" style={{ fontSize: 10 }}>
              <SolutionOutlined style={{ marginRight: 3 }} />
              {r.enmo || "—"}
            </Text>
          </div>
        </Tooltip>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 120,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="View">
            <Button
              size="small"
              type="text"
              icon={<EyeOutlined />}
              onClick={() => setDetailModal(r)}
            />
          </Tooltip>
          {canEdit && (
            <Tooltip title="Edit">
              <Button
                size="small"
                type="text"
                icon={<EditOutlined />}
                onClick={() => openEdit(r)}
              />
            </Tooltip>
          )}
          {canDelete && (
            <Tooltip title="Delete">
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => reviewAndDeleteRecord(r)}
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  const handleExport = () => {
    const rows = filtered.map((r, i) => ({
      "#": i + 1,
      Province: r.province,
      LGU: r.lgu,
      Barangay: r.barangay,
      Ownership: r.ownership,
      Category: r.category,
      Status: r.statusOfSLF,
      "Year Started": r.yearStartedOperation,
      "Capacity per day": r.receivingVolumeCapacity ?? r.volumeCapacity,
      "Capacity Unit": normalizeUnit(
        r.receivingVolumeCapacity != null
          ? r.receivingVolumeCapacityUnit || r.volumeCapacityUnit || "m³"
          : r.volumeCapacityUnit || "m³",
      ),
      "LGUs Served": r.noOfLGUServed,
      Cells: r.numberOfCell,
      "Leachate & Gas": `Leachate: ${r.noOfLeachatePond || 0}; Gas: ${r.numberOfGasVents || 0}`,
      "Waste Received": r.actualResidualWasteReceived,
      "Waste Received Unit": normalizeUnit(r.wasteReceivedUnit || "m³"),
      "Target Month": r.targetMonth,
      ENMO: r.enmo,
      Focal: r.focalPerson,
    }));
    exportToExcel(rows, "SLF_Facilities_Data");
  };

  const renderSlfSummaryTiles = () => (
    <>
      {/* Summary tiles */}
      {loading ? (
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Col xs={12} sm={6} md={6} lg={3} key={i}>
              <Card
                size="small"
                style={{ borderRadius: 8, height: "100%", padding: 0 }}
                bodyStyle={{ padding: "8px 12px" }}
              >
                <Skeleton
                  active
                  paragraph={{ rows: 1 }}
                  title={{ width: "60%" }}
                />
              </Card>
            </Col>
          ))}
        </Row>
      ) : (
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
          <Col xs={12} sm={6} md={6} lg={3}>
            <DashboardMetricCard
              active={quickFilter === "operational"}
              color={ACCENT}
              icon={<BankOutlined style={{ color: ACCENT, fontSize: 14 }} />}
              title="Total SLF"
              value={totalRecords}
              summary={`${opCount} operational`}
              breakdowns={[
                `${nonOpCount} non-operational`,
                `${totalRecords - opCount - nonOpCount} other status`,
              ]}
              onClick={() =>
                setQuickFilter(
                  quickFilter === "operational" ? null : "operational",
                )
              }
            />
          </Col>
          <Col xs={12} sm={6} md={6} lg={3}>
            <DashboardMetricCard
              active={quickFilter === "withCells"}
              color="#13c2c2"
              icon={
                <ExperimentOutlined
                  style={{ color: "#13c2c2", fontSize: 14 }}
                />
              }
              title="Cell Infrastructure"
              value={totalCells}
              summary={`${cellsWithData}/${totalRecords} SLFs`}
              breakdowns={Object.entries(cellStatusSummary)
                .slice(0, 2)
                .map(([status, count]) => `${count} ${status}`)}
              onClick={() => {
                setQuickFilter(
                  quickFilter === "withCells" ? null : "withCells",
                );
                setSlfInsightModal("cells");
              }}
            />
          </Col>
          <Col xs={12} sm={6} md={6} lg={3}>
            <DashboardMetricCard
              active={quickFilter === "withLGUs"}
              color="#fa8c16"
              icon={<TeamOutlined style={{ color: "#fa8c16", fontSize: 14 }} />}
              title="LGUs Served"
              value={totalLGUs}
              summary={`${lgusWithData}/${totalRecords} reporting`}
              breakdowns={[
                `${region3LguServed} Region 3`,
                `${outsideRegionLguServed} outside/other`,
              ]}
              onClick={() => {
                setQuickFilter(quickFilter === "withLGUs" ? null : "withLGUs");
                setSlfInsightModal("lgu");
              }}
            />
          </Col>
          <Col xs={12} sm={6} md={6} lg={3}>
            <DashboardMetricCard
              active={quickFilter === "private"}
              color="#722ed1"
              icon={<BankOutlined style={{ color: "#722ed1", fontSize: 14 }} />}
              title="Private Sector Served"
              value={privateClientsTotal || privateSectorCount}
              summary={`${privateSectorCount} private SLFs`}
              breakdowns={[
                `${privateClientsTotal} client records`,
                `${privateWithData}/${totalRecords} reporting`,
              ]}
              onClick={() => {
                setQuickFilter(quickFilter === "private" ? null : "private");
                setSlfInsightModal("private");
              }}
            />
          </Col>
          <Col xs={12} sm={6} md={6} lg={3}>
            <DashboardMetricCard
              active={quickFilter === "withCapacity"}
              color="#eb2f96"
              icon={
                <DatabaseOutlined style={{ color: "#eb2f96", fontSize: 14 }} />
              }
              title="SLF Total Capacities"
              value={totalCapacity}
              formatter={(v) => formatCompact(v)}
              summary={`${capacityWithData}/${totalRecords} with data`}
              breakdowns={[
                `${formatCompact(receivingCapacityTotal)} receiving`,
                `${capacityUsePercent.toFixed(1)}% used`,
              ]}
              onClick={() => {
                setQuickFilter(
                  quickFilter === "withCapacity" ? null : "withCapacity",
                );
                setSlfInsightModal("capacity");
              }}
            />
          </Col>
          <Col xs={12} sm={6} md={6} lg={3}>
            <DashboardMetricCard
              active={quickFilter === "withWaste"}
              color="#ff4d4f"
              icon={
                <BarChartOutlined style={{ color: "#ff4d4f", fontSize: 14 }} />
              }
              title="Waste Received"
              value={totalWaste}
              suffix={wasteUnitLabel}
              formatter={(v) => formatCompact(v)}
              summary={`${wasteWithData}/${totalRecords} reporting`}
              breakdowns={[
                `${formatCompact(wasteWithData ? totalWaste / wasteWithData : 0)} avg`,
                `${capacityUsePercent.toFixed(1)}% capacity`,
              ]}
              onClick={() => {
                setQuickFilter(
                  quickFilter === "withWaste" ? null : "withWaste",
                );
                setSlfInsightModal("waste");
              }}
            />
          </Col>
          <Col xs={12} sm={6} md={6} lg={3}>
            <DashboardMetricCard
              active={quickFilter === "withLeachate"}
              color="#1890ff"
              icon={
                <AlertOutlined style={{ color: "#1890ff", fontSize: 14 }} />
              }
              title="Leachate Management"
              value={totalLeachate}
              summary={`${leachateWithData}/${totalRecords} SLFs`}
              breakdowns={Object.entries(leachateStatusSummary)
                .slice(0, 2)
                .map(([status, count]) => `${count} ${status}`)}
              onClick={() => {
                setQuickFilter(
                  quickFilter === "withLeachate" ? null : "withLeachate",
                );
                setSlfInsightModal("leachate");
              }}
            />
          </Col>
          <Col xs={12} sm={6} md={6} lg={3}>
            <DashboardMetricCard
              active={quickFilter === "withGas"}
              color="#52c41a"
              icon={
                <ExperimentOutlined
                  style={{ color: "#52c41a", fontSize: 14 }}
                />
              }
              title="Gas Management"
              value={totalGasVents}
              summary={`${gasVentsWithData}/${totalRecords} SLFs`}
              breakdowns={Object.entries(gasStatusSummary)
                .slice(0, 2)
                .map(([status, count]) => `${count} ${status}`)}
              onClick={() => {
                setQuickFilter(quickFilter === "withGas" ? null : "withGas");
                setSlfInsightModal("gas");
              }}
            />
          </Col>
        </Row>
      )}
    </>
  );
  return (
    <div style={{ padding: 0 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div>
          <Title level={3} style={{ margin: 0 }}>
            SLF Data Table
          </Title>
          <Text type="secondary">
            Sanitary landfill facility records and portal-submitted waste
            generator data.
          </Text>
        </div>
        <Space wrap>
          <Tag bordered={false} color={hasFilters ? "blue" : "default"}>
            {filtered.length} / {records.length} records
          </Tag>
          {hasFilters && (
            <Button
              size="small"
              type="link"
              icon={<ClearOutlined />}
              onClick={clearFilters}
            >
              Clear filters
            </Button>
          )}
        </Space>
      </div>

      <Tabs
        defaultActiveKey="facilities"
        destroyOnHidden
        items={[
          {
            key: "facilities",
            label: (
              <>
                <BankOutlined /> Sanitary Landfill Facility
              </>
            ),
            children: (
              <>
                {renderSlfSummaryTiles()}

                {/* Header with Search + Export */}
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
                    <BankOutlined /> Sanitary Landfill Facility
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
                    {canEdit && (
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={openAdd}
                        style={{ background: ACCENT, borderColor: ACCENT }}
                      >
                        Add Record
                      </Button>
                    )}
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
                      <FilterOutlined
                        style={{ color: ACCENT, marginRight: 6 }}
                      />
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
                          style={{
                            width: "100%",
                            minWidth: 120,
                            maxWidth: 160,
                          }}
                          size="small"
                          options={provinceOptions}
                          suffixIcon={<EnvironmentOutlined />}
                        />
                        <Select
                          placeholder="Status"
                          value={filterStatus}
                          onChange={setFilterStatus}
                          allowClear
                          style={{
                            width: "100%",
                            minWidth: 110,
                            maxWidth: 160,
                          }}
                          size="small"
                          options={buildFilters(records, "statusOfSLF")}
                          suffixIcon={<SafetyCertificateOutlined />}
                        />
                        <Select
                          placeholder="Category"
                          value={filterCategory}
                          onChange={setFilterCategory}
                          allowClear
                          style={{
                            width: "100%",
                            minWidth: 110,
                            maxWidth: 150,
                          }}
                          size="small"
                          options={buildFilters(records, "category")}
                        />
                        <Select
                          placeholder="Target Month"
                          value={filterMonth}
                          onChange={setFilterMonth}
                          allowClear
                          style={{
                            width: "100%",
                            minWidth: 110,
                            maxWidth: 150,
                          }}
                          size="small"
                          options={monthOptions}
                          suffixIcon={<CalendarOutlined />}
                        />
                        {hasFilters && (
                          <Tooltip title="Clear all filters">
                            <Button
                              size="small"
                              type="link"
                              danger
                              icon={<ClearOutlined />}
                              onClick={clearFilters}
                            >
                              Clear
                            </Button>
                          </Tooltip>
                        )}
                      </Space>
                    </Col>
                    <Col>
                      <Tag
                        bordered={false}
                        color={hasFilters ? "blue" : "default"}
                      >
                        {filtered.length} / {records.length} records
                      </Tag>
                    </Col>
                  </Row>
                </Card>

                {/* Table */}
                <Card size="small" style={{ borderRadius: 10 }}>
                  <ResponsiveTable
                    className="slf-table"
                    dataSource={filtered}
                    columns={columns}
                    rowKey="_id"
                    loading={loading}
                    size="small"
                    pagination={{
                      pageSize: 50,
                      showSizeChanger: true,
                      showTotal: (t) => `${t} records`,
                    }}
                  />
                </Card>
              </>
            ),
          },
          {
            key: "portal",
            label: (
              <>
                <LinkOutlined /> Waste Generators
              </>
            ),
            children: (
              <PortalGenerators
                generators={generators}
                loadingGen={loadingGen}
                fetchGenerators={fetchGenerators}
                slfRecords={records}
                canEdit={canEdit}
                canDelete={canDelete}
                isDark={isDark}
              />
            ),
          },
        ]}
      />

      {/* Add/Edit Modal */}
      <Modal
        title={
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingRight: 36,
            }}
          >
            <Space size={6}>
              {editing?._id ? (
                <>
                  <EditOutlined style={{ color: ACCENT }} />
                  <span>Edit SLF Facility</span>
                  <Text
                    type="secondary"
                    style={{ fontWeight: 400, fontSize: 13 }}
                  >
                    —
                  </Text>
                  <Text strong style={{ color: ACCENT, fontSize: 14 }}>
                    {editing.lgu || ""}
                  </Text>
                  {editing.province && (
                    <Text
                      type="secondary"
                      style={{ fontSize: 12, fontWeight: 400 }}
                    >
                      {editing.province}
                    </Text>
                  )}
                </>
              ) : (
                <span>Add SLF Facility</span>
              )}
            </Space>
            <Space size={6}>
              <Button
                size="small"
                icon={<CalculatorOutlined />}
                onClick={() => setConvModalOpen(true)}
                style={{
                  fontSize: 11,
                  borderRadius: 6,
                  background: isDark ? "rgba(82,196,26,0.15)" : "#f6ffed",
                  borderColor: "#b7eb8f",
                  color: "#389e0d",
                }}
              >
                Converter
              </Button>
              <Button
                size="small"
                icon={<DatabaseOutlined />}
                onClick={() => setUnitToolOpen(true)}
                style={{ fontSize: 11, borderRadius: 6 }}
              >
                Set Units
              </Button>
            </Space>
          </div>
        }
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
          setConvArea(null);
          setConvDepth(null);
          setConvVol(null);
          setConvDensity(0.2);
          setConvM3ToTons(null);
          setConvModalOpen(false);
          setUnitToolOpen(false);
        }}
        onOk={handleSave}
        width={1400}
        okText="Save"
        confirmLoading={saving}
        okButtonProps={{
          loading: saving,
          style: { background: ACCENT, borderColor: ACCENT },
        }}
        maskClosable={!saving}
        keyboard={!saving}
        destroyOnHidden
      >
        <Spin
          spinning={saving}
          tip="Saving SLF data records..."
          size="large"
        >
          <Form form={form} layout="vertical" size="small">
          <Tabs
            defaultActiveKey="location"
            tabPosition="left"
            size="small"
            style={{ minHeight: 400 }}
            tabBarStyle={{
              background: isDark ? "rgba(22,119,255,0.08)" : "#f0f5ff",
              borderRight: `1px solid ${isDark ? "#1d3a6b" : "#d6e4ff"}`,
              borderRadius: "8px 0 0 8px",
              padding: "8px 0",
            }}
            items={[
              {
                key: "location",
                label: (
                  <span style={{ color: "#1677ff" }}>
                    <EnvironmentOutlined /> Location
                  </span>
                ),
                children: (
                  <Row gutter={[12, 0]}>
                    {/* Province and Barangay side by side */}
                    <Col span={12}>
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
                    <Col span={12}>
                      <Form.Item name="barangay" label="Barangay">
                        <Input placeholder="Enter barangay name" />
                      </Form.Item>
                    </Col>
                    {/* LGU full-width textarea */}
                    <Col span={24}>
                      <Form.Item
                        name="lgu"
                        label="LGU Name"
                        rules={[{ required: true }]}
                      >
                        <Input.TextArea
                          rows={2}
                          placeholder="Enter full LGU name"
                          autoSize={{ minRows: 2, maxRows: 3 }}
                          style={{ resize: "none" }}
                        />
                      </Form.Item>
                    </Col>
                    {/* Manila Bay Area | Congressional District | Ownership */}
                    <Col span={8}>
                      <Form.Item name="manilaBayArea" label="Manila Bay Area">
                        <Select
                          options={mbaOptions}
                          allowClear
                          placeholder="Select"
                        />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item
                        name="congressionalDistrict"
                        label="Congressional District"
                      >
                        <Select
                          allowClear
                          showSearch
                          placeholder="Select District"
                          options={districtOptions}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="ownership" label="Ownership">
                        <Select
                          allowClear
                          placeholder="Select Ownership"
                          options={(() => {
                            const defaults = ["Public", "Private"];
                            const existing = ownershipOptions.map(
                              (o) => o.value,
                            );
                            const merged = [
                              ...defaults,
                              ...existing.filter((v) => !defaults.includes(v)),
                            ];
                            return merged.map((v) => ({ label: v, value: v }));
                          })()}
                        />
                      </Form.Item>
                    </Col>
                    {/* Coordinates */}
                    <Col span={12}>
                      <Form.Item name="latitude" label="Latitude">
                        <InputNumber
                          style={{ width: "100%" }}
                          step={0.001} precision={3}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="longitude" label="Longitude">
                        <InputNumber
                          style={{ width: "100%" }}
                          step={0.001} precision={3}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={24}>
                      <Button
                        size="small"
                        icon={<EnvironmentOutlined />}
                        onClick={openMapPreview}
                      >
                        View in Maps
                      </Button>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "facility",
                label: (
                  <span style={{ color: "#fa8c16" }}>
                    <BankOutlined /> Facility Details
                  </span>
                ),
                children: (
                  <>
                    <Row gutter={12}>
                      <Col span={6}>
                        <Form.Item
                          name="yearStartedOperation"
                          label="Year Started"
                        >
                          <InputNumber style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name="category" label="SLF Category">
                          <Select
                            allowClear
                            showSearch
                            placeholder="Select Category"
                            options={categoryOptions}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item
                          label="Capacity per day"
                          style={{ marginBottom: 0 }}
                        >
                          <Space.Compact style={{ width: "100%" }}>
                            <Form.Item name="receivingVolumeCapacity" noStyle>
                              <InputNumber
                                style={{ width: "calc(100% - 80px)" }}
                                min={0}
                                placeholder="Receiving capacity"
                              />
                            </Form.Item>
                            <Form.Item
                              name="receivingVolumeCapacityUnit"
                              noStyle
                            >
                              <Select
                                style={{ width: 80 }}
                                options={UNIT_OPTIONS}
                                defaultValue="m³"
                              />
                            </Form.Item>
                          </Space.Compact>
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item noStyle dependencies={["ownership"]}>
                          {() => {
                            const own = form.getFieldValue("ownership") || "";
                            const isPrivate = /private/i.test(own);
                            return isPrivate ? (
                              <Form.Item
                                name="privateCompaniesServed"
                                label="Private Companies Served"
                              >
                                <Select
                                  mode="tags"
                                  placeholder="Type & press Enter to add companies"
                                  style={{ width: "100%" }}
                                  tokenSeparators={[","]}
                                />
                              </Form.Item>
                            ) : (
                              <Form.Item
                                name="lguServedList"
                                label="LGUs Served"
                              >
                                <Select
                                  mode="tags"
                                  placeholder="Type & press Enter to add LGUs"
                                  style={{ width: "100%" }}
                                  tokenSeparators={[","]}
                                />
                              </Form.Item>
                            );
                          }}
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name="statusOfSLF" label="Status">
                          <Select
                            options={slfStatusOptions}
                            allowClear
                            placeholder="Select Status"
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider
                      orientation="left"
                      style={{ fontSize: 13, color: "#fa8c16", marginTop: 18 }}
                    >
                      <BankOutlined style={{ marginRight: 6 }} />
                      Receiving Facility Table
                    </Divider>
                    <Form.List name="receivingFacilities">
                      {(fields, { add, remove }) => (
                        <>
                          <Table
                            size="small"
                            pagination={false}
                            dataSource={fields}
                            rowKey="key"
                            locale={{
                              emptyText: "No receiving facilities added yet",
                            }}
                            scroll={{ x: 880 }}
                            style={{ marginBottom: 8 }}
                            columns={[
                              {
                                title: "No.",
                                width: 64,
                                align: "center",
                                render: (_, __, index) => index + 1,
                              },
                              {
                                title: "MRF Type",
                                width: 260,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "mrfTypes"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Select
                                      mode="multiple"
                                      size="small"
                                      placeholder="Select type"
                                      options={RECEIVING_FACILITY_TYPE_OPTIONS}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "MRF Name",
                                width: 220,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "mrfName"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Input
                                      size="small"
                                      placeholder="Facility name"
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Status",
                                width: 150,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "status"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Select
                                      size="small"
                                      allowClear
                                      placeholder="Status"
                                      options={[
                                        { label: "Active", value: "Active" },
                                        {
                                          label: "Inactive",
                                          value: "Inactive",
                                        },
                                        {
                                          label: "Proposed",
                                          value: "Proposed",
                                        },
                                        {
                                          label: "Under Construction",
                                          value: "Under Construction",
                                        },
                                      ]}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Description",
                                width: 260,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "description"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Input.TextArea
                                      rows={1}
                                      placeholder="Description"
                                      autoSize={{ minRows: 1, maxRows: 3 }}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "",
                                width: 56,
                                align: "center",
                                render: (_, field) => (
                                  <Button
                                    size="small"
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => remove(field.name)}
                                  />
                                ),
                              },
                            ]}
                          />
                          <Button
                            type="dashed"
                            onClick={() =>
                              add({ mrfTypes: [], status: "Active" })
                            }
                            block
                            icon={<PlusOutlined />}
                          >
                            Add Receiving Facility
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </>
                ),
              },
              {
                key: "leachate-gas",
                label: (
                  <span style={{ color: "#1677ff" }}>
                    <AlertOutlined /> Leachate &amp; Gas Management
                  </span>
                ),
                children: (
                  <>
                    {/* Counts summary — auto-synced from form list entries */}
                    <Form.Item
                      noStyle
                      dependencies={["leachatePondDetails", "gasVentDetails"]}
                    >
                      {() => {
                        const ponds =
                          form.getFieldValue("leachatePondDetails") || [];
                        const vents =
                          form.getFieldValue("gasVentDetails") || [];
                        const savedPondCount =
                          editing?.noOfLeachatePond ?? null;
                        const savedVentCount =
                          editing?.numberOfGasVents ?? null;
                        const pondStatusMap = ponds.reduce((acc, p) => {
                          const s = p?.status || "Active";
                          acc[s] = (acc[s] || 0) + 1;
                          return acc;
                        }, {});
                        const ventStatusMap = vents.reduce((acc, v) => {
                          const s = v?.status || "Active";
                          acc[s] = (acc[s] || 0) + 1;
                          return acc;
                        }, {});
                        const statusColor = {
                          Active: "#52c41a",
                          Inactive: "#8c8c8c",
                          "Under Maintenance": "#fa8c16",
                          Decommissioned: "#ff4d4f",
                        };
                        return (
                          <Row gutter={12} style={{ marginBottom: 16 }}>
                            <Col span={12}>
                              <Card
                                size="small"
                                style={{
                                  borderRadius: 8,
                                  border: `1px solid ${isDark ? "#1d3a6b" : "#bae0ff"}`,
                                  background: isDark
                                    ? "rgba(23,119,255,0.06)"
                                    : "#e6f4ff",
                                }}
                                title={
                                  <Space size={6}>
                                    <AlertOutlined
                                      style={{ color: "#1677ff" }}
                                    />
                                    <Text
                                      strong
                                      style={{
                                        fontSize: 12,
                                        color: isDark ? "#69b1ff" : "#0958d9",
                                      }}
                                    >
                                      Leachate Treatment Plant
                                    </Text>
                                    <Tag
                                      color="blue"
                                      style={{ fontSize: 11, borderRadius: 10 }}
                                    >
                                      {ponds.length} in list
                                    </Tag>
                                    {savedPondCount !== null &&
                                      savedPondCount !== ponds.length && (
                                        <Tag
                                          color="orange"
                                          style={{
                                            fontSize: 11,
                                            borderRadius: 10,
                                          }}
                                        >
                                          {savedPondCount} saved
                                        </Tag>
                                      )}
                                    {savedPondCount !== null &&
                                      savedPondCount === ponds.length && (
                                        <Tag
                                          color="green"
                                          style={{
                                            fontSize: 11,
                                            borderRadius: 10,
                                          }}
                                        >
                                          matches saved
                                        </Tag>
                                      )}
                                  </Space>
                                }
                              >
                                {ponds.length === 0 ? (
                                  <Text
                                    type="secondary"
                                    style={{ fontSize: 11 }}
                                  >
                                    No Leachate Treatment Plant added yet.
                                  </Text>
                                ) : (
                                  <table
                                    style={{
                                      width: "100%",
                                      borderCollapse: "collapse",
                                      fontSize: 11,
                                    }}
                                  >
                                    <thead>
                                      <tr
                                        style={{
                                          background: isDark
                                            ? "rgba(255,255,255,0.04)"
                                            : "#f0f5ff",
                                        }}
                                      >
                                        <th
                                          style={{
                                            padding: "4px 8px",
                                            textAlign: "left",
                                            fontWeight: 600,
                                            borderBottom: "1px solid #d9d9d9",
                                          }}
                                        >
                                          No.
                                        </th>
                                        <th
                                          style={{
                                            padding: "4px 8px",
                                            textAlign: "left",
                                            fontWeight: 600,
                                            borderBottom: "1px solid #d9d9d9",
                                          }}
                                        >
                                          Status
                                        </th>
                                        <th
                                          style={{
                                            padding: "4px 8px",
                                            textAlign: "left",
                                            fontWeight: 600,
                                            borderBottom: "1px solid #d9d9d9",
                                          }}
                                        >
                                          Notes
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {ponds.map((p, idx) => (
                                        <tr
                                          key={idx}
                                          style={{
                                            borderBottom: "1px solid #f0f0f0",
                                          }}
                                        >
                                          <td style={{ padding: "3px 8px" }}>
                                            Pond {p?.pondNo || idx + 1}
                                          </td>
                                          <td style={{ padding: "3px 8px" }}>
                                            <Tag
                                              color={
                                                statusColor[p?.status]
                                                  ? undefined
                                                  : "default"
                                              }
                                              style={{
                                                fontSize: 10,
                                                color: statusColor[p?.status],
                                                borderColor:
                                                  statusColor[p?.status],
                                                background: "transparent",
                                              }}
                                            >
                                              {p?.status || "Active"}
                                            </Tag>
                                          </td>
                                          <td
                                            style={{
                                              padding: "3px 8px",
                                              color: "#8c8c8c",
                                              maxWidth: 120,
                                              overflow: "hidden",
                                              textOverflow: "ellipsis",
                                              whiteSpace: "nowrap",
                                            }}
                                          >
                                            {p?.description || "—"}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                                {Object.keys(pondStatusMap).length > 0 && (
                                  <div
                                    style={{
                                      marginTop: 6,
                                      display: "flex",
                                      gap: 6,
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    {Object.entries(pondStatusMap).map(
                                      ([s, c]) => (
                                        <Tag
                                          key={s}
                                          style={{
                                            fontSize: 10,
                                            color: statusColor[s],
                                            borderColor: statusColor[s],
                                            background: "transparent",
                                          }}
                                        >
                                          {c} {s}
                                        </Tag>
                                      ),
                                    )}
                                  </div>
                                )}
                              </Card>
                            </Col>
                            <Col span={12}>
                              <Card
                                size="small"
                                style={{
                                  borderRadius: 8,
                                  border: `1px solid ${isDark ? "#1a3d20" : "#b7eb8f"}`,
                                  background: isDark
                                    ? "rgba(82,196,26,0.06)"
                                    : "#f6ffed",
                                }}
                                title={
                                  <Space size={6}>
                                    <ExperimentOutlined
                                      style={{ color: "#52c41a" }}
                                    />
                                    <Text
                                      strong
                                      style={{
                                        fontSize: 12,
                                        color: isDark ? "#95de64" : "#389e0d",
                                      }}
                                    >
                                      Gas Management
                                    </Text>
                                    <Tag
                                      color="green"
                                      style={{ fontSize: 11, borderRadius: 10 }}
                                    >
                                      {vents.length} in list
                                    </Tag>
                                    {savedVentCount !== null &&
                                      savedVentCount !== vents.length && (
                                        <Tag
                                          color="orange"
                                          style={{
                                            fontSize: 11,
                                            borderRadius: 10,
                                          }}
                                        >
                                          {savedVentCount} saved
                                        </Tag>
                                      )}
                                    {savedVentCount !== null &&
                                      savedVentCount === vents.length && (
                                        <Tag
                                          color="green"
                                          style={{
                                            fontSize: 11,
                                            borderRadius: 10,
                                          }}
                                        >
                                          matches saved
                                        </Tag>
                                      )}
                                  </Space>
                                }
                              >
                                {vents.length === 0 ? (
                                  <Text
                                    type="secondary"
                                    style={{ fontSize: 11 }}
                                  >
                                    No gas management records added yet.
                                  </Text>
                                ) : (
                                  <table
                                    style={{
                                      width: "100%",
                                      borderCollapse: "collapse",
                                      fontSize: 11,
                                    }}
                                  >
                                    <thead>
                                      <tr
                                        style={{
                                          background: isDark
                                            ? "rgba(255,255,255,0.04)"
                                            : "#f6ffed",
                                        }}
                                      >
                                        <th
                                          style={{
                                            padding: "4px 8px",
                                            textAlign: "left",
                                            fontWeight: 600,
                                            borderBottom: "1px solid #d9d9d9",
                                          }}
                                        >
                                          No.
                                        </th>
                                        <th
                                          style={{
                                            padding: "4px 8px",
                                            textAlign: "left",
                                            fontWeight: 600,
                                            borderBottom: "1px solid #d9d9d9",
                                          }}
                                        >
                                          Type
                                        </th>
                                        <th
                                          style={{
                                            padding: "4px 8px",
                                            textAlign: "left",
                                            fontWeight: 600,
                                            borderBottom: "1px solid #d9d9d9",
                                          }}
                                        >
                                          Status
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {vents.map((v, idx) => (
                                        <tr
                                          key={idx}
                                          style={{
                                            borderBottom: "1px solid #f0f0f0",
                                          }}
                                        >
                                          <td style={{ padding: "3px 8px" }}>
                                            Vent {v?.ventNo || idx + 1}
                                          </td>
                                          <td style={{ padding: "3px 8px" }}>
                                            {v?.ventType || "—"}
                                          </td>
                                          <td style={{ padding: "3px 8px" }}>
                                            <Tag
                                              color={
                                                statusColor[v?.status]
                                                  ? undefined
                                                  : "default"
                                              }
                                              style={{
                                                fontSize: 10,
                                                color: statusColor[v?.status],
                                                borderColor:
                                                  statusColor[v?.status],
                                                background: "transparent",
                                              }}
                                            >
                                              {v?.status || "Active"}
                                            </Tag>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                                {Object.keys(ventStatusMap).length > 0 && (
                                  <div
                                    style={{
                                      marginTop: 6,
                                      display: "flex",
                                      gap: 6,
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    {Object.entries(ventStatusMap).map(
                                      ([s, c]) => (
                                        <Tag
                                          key={s}
                                          style={{
                                            fontSize: 10,
                                            color: statusColor[s],
                                            borderColor: statusColor[s],
                                            background: "transparent",
                                          }}
                                        >
                                          {c} {s}
                                        </Tag>
                                      ),
                                    )}
                                  </div>
                                )}
                              </Card>
                            </Col>
                          </Row>
                        );
                      }}
                    </Form.Item>
                    <Card
                      size="small"
                      style={{ borderRadius: 8, marginBottom: 16 }}
                    >
                      <Row gutter={[12, 12]} align="middle">
                        <Col xs={24} md={8}>
                          <Form.Item
                            name="hasWastewaterTreatmentFacility"
                            valuePropName="checked"
                            style={{ marginBottom: 0 }}
                          >
                            <Checkbox>Wastewater Treatment Facility</Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                          <Form.Item
                            noStyle
                            dependencies={["hasWastewaterTreatmentFacility"]}
                          >
                            {() => (
                              <Form.Item
                                name="wastewaterTreatmentFacilityType"
                                label="Treatment Type"
                                style={{ marginBottom: 0 }}
                              >
                                <Select
                                  mode="multiple"
                                  allowClear
                                  placeholder="Select treatment type(s)"
                                  disabled={
                                    !form.getFieldValue(
                                      "hasWastewaterTreatmentFacility",
                                    )
                                  }
                                  options={WWTF_TYPE_OPTIONS}
                                />
                              </Form.Item>
                            )}
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                          <Form.Item
                            noStyle
                            dependencies={["hasWastewaterTreatmentFacility"]}
                          >
                            {() => (
                              <Form.Item
                                name="wastewaterTreatmentFacilityRemarks"
                                label="Remarks"
                                style={{ marginBottom: 0 }}
                              >
                                <Input.TextArea
                                  rows={2}
                                  placeholder="Add WWTF remarks"
                                  disabled={
                                    !form.getFieldValue(
                                      "hasWastewaterTreatmentFacility",
                                    )
                                  }
                                />
                              </Form.Item>
                            )}
                          </Form.Item>
                        </Col>
                      </Row>
                    </Card>

                    <Divider
                      orientation="left"
                      style={{ fontSize: 13, color: "#1677ff", marginTop: 0 }}
                    >
                      <AlertOutlined style={{ marginRight: 6 }} />
                      Leachate Treatment Plant
                    </Divider>
                    <Form.List name="leachatePondDetails">
                      {(fields, { add, remove }) => (
                        <>
                          <Table
                            size="small"
                            pagination={false}
                            dataSource={fields}
                            rowKey="key"
                            locale={{
                              emptyText:
                                "No Leachate Treatment Plant added yet",
                            }}
                            scroll={{ x: 760 }}
                            style={{ marginBottom: 8 }}
                            columns={[
                              {
                                title: "Pond No.",
                                width: 100,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "pondNo"]}
                                    style={{ margin: 0 }}
                                  >
                                    <InputNumber
                                      size="small"
                                      style={{ width: "100%" }}
                                      min={1}
                                      precision={0}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Status",
                                width: 180,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "status"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Select
                                      size="small"
                                      placeholder="Select status"
                                      options={[
                                        { label: "Active", value: "Active" },
                                        {
                                          label: "Inactive",
                                          value: "Inactive",
                                        },
                                        {
                                          label: "Under Maintenance",
                                          value: "Under Maintenance",
                                        },
                                        {
                                          label: "Decommissioned",
                                          value: "Decommissioned",
                                        },
                                      ]}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Description / Condition Notes",
                                width: 320,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "description"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Input.TextArea
                                      rows={1}
                                      placeholder="Pond dimensions, lining type, current condition..."
                                      autoSize={{ minRows: 1, maxRows: 3 }}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "",
                                width: 56,
                                align: "center",
                                render: (_, field) => (
                                  <Button
                                    size="small"
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => remove(field.name)}
                                  />
                                ),
                              },
                            ]}
                          />
                          <Button
                            type="dashed"
                            onClick={() =>
                              add({
                                pondNo: fields.length + 1,
                                status: "Active",
                              })
                            }
                            block
                            icon={<PlusOutlined />}
                            style={{ marginBottom: 4 }}
                          >
                            Add Leachate Treatment Plant
                          </Button>
                        </>
                      )}
                    </Form.List>

                    <Divider
                      orientation="left"
                      style={{ fontSize: 13, color: "#52c41a", marginTop: 16 }}
                    >
                      <ExperimentOutlined style={{ marginRight: 6 }} />
                      Gas Management
                    </Divider>
                    <Form.List name="gasVentDetails">
                      {(fields, { add, remove }) => (
                        <>
                          <Table
                            size="small"
                            pagination={false}
                            dataSource={fields}
                            rowKey="key"
                            locale={{
                              emptyText: "No gas management records added yet",
                            }}
                            scroll={{ x: 770 }}
                            style={{ marginBottom: 8 }}
                            columns={[
                              {
                                title: "Vent No.",
                                width: 100,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "ventNo"]}
                                    style={{ margin: 0 }}
                                  >
                                    <InputNumber
                                      size="small"
                                      style={{ width: "100%" }}
                                      min={1}
                                      precision={0}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Type",
                                width: 170,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "ventType"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Select
                                      size="small"
                                      placeholder="Select type"
                                      allowClear
                                      options={[
                                        { label: "Passive", value: "Passive" },
                                        { label: "Flare", value: "Flare" },
                                        {
                                          label: "LFG Recovery",
                                          value: "LFG Recovery",
                                        },
                                        { label: "Other", value: "Other" },
                                      ]}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Status",
                                width: 180,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "status"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Select
                                      size="small"
                                      placeholder="Select status"
                                      options={[
                                        { label: "Active", value: "Active" },
                                        {
                                          label: "Inactive",
                                          value: "Inactive",
                                        },
                                        {
                                          label: "Under Maintenance",
                                          value: "Under Maintenance",
                                        },
                                        {
                                          label: "Decommissioned",
                                          value: "Decommissioned",
                                        },
                                      ]}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Description / Notes",
                                width: 320,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "description"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Input.TextArea
                                      rows={1}
                                      placeholder="Pipe diameter, depth, condition..."
                                      autoSize={{ minRows: 1, maxRows: 3 }}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "",
                                width: 56,
                                align: "center",
                                render: (_, field) => (
                                  <Button
                                    size="small"
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => remove(field.name)}
                                  />
                                ),
                              },
                            ]}
                          />
                          <Button
                            type="dashed"
                            onClick={() =>
                              add({
                                ventNo: fields.length + 1,
                                status: "Active",
                              })
                            }
                            block
                            icon={<PlusOutlined />}
                            style={{ marginBottom: 4 }}
                          >
                            Add Gas Management Record
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </>
                ),
              },
              {
                key: "cell-infra",
                label: (
                  <span style={{ color: "#13c2c2" }}>
                    <BarChartOutlined /> Cell Infrastructure
                  </span>
                ),
                children: (
                  <>
                    <Row gutter={12}>
                      <Col span={8}>
                        <Form.Item name="numberOfCell" label="No. of Cells">
                          <Select
                            placeholder="Select"
                            allowClear
                            options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(
                              (n) => ({ label: `${n}`, value: n }),
                            )}
                            onChange={(val) => {
                              const cur =
                                form.getFieldValue("cellCapacities") || [];
                              const curUnits =
                                form.getFieldValue("cellCapacityUnits") || [];
                              const curSt =
                                form.getFieldValue("cellStatuses") || [];
                              const curTy =
                                form.getFieldValue("cellTypes") || [];
                              const curSubAllowed =
                                form.getFieldValue("cellSubmissionAllowed") || [];
                              const curNotes =
                                form.getFieldValue("cellNotes") || [];
                              const curFill =
                                form.getFieldValue("cellFillValues") || [];
                              const curFillUnits =
                                form.getFieldValue("cellFillUnits") || [];
                              const next = Array.from(
                                { length: val || 0 },
                                (_, i) => cur[i] ?? null,
                              );
                              const nextUnits = Array.from(
                                { length: val || 0 },
                                (_, i) => curUnits[i] || "m³",
                              );
                              const nextSt = Array.from(
                                { length: val || 0 },
                                (_, i) => normalizeCellStatus(curSt[i]),
                              );
                              const nextTy = Array.from(
                                { length: val || 0 },
                                (_, i) => curTy[i] || "Residual",
                              );
                              const nextSubAllowed = Array.from(
                                { length: val || 0 },
                                (_, i) => (curSubAllowed[i] === undefined ? true : curSubAllowed[i]),
                              );
                              const nextNotes = Array.from(
                                { length: val || 0 },
                                (_, i) => curNotes[i] || "",
                              );
                              const nextFill = Array.from(
                                { length: val || 0 },
                                (_, i) => curFill[i] ?? null,
                              );
                              const nextFillUnits = Array.from(
                                { length: val || 0 },
                                (_, i) => curFillUnits[i] || nextUnits[i] || "m³",
                              );
                              form.setFieldsValue({
                                cellCapacities: next,
                                cellCapacityUnits: nextUnits,
                                cellStatuses: nextSt,
                                cellTypes: nextTy,
                                cellSubmissionAllowed: nextSubAllowed,
                                cellNotes: nextNotes,
                                cellFillValues: nextFill,
                                cellFillUnits: nextFillUnits,
                              });
                            }}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={16}>
                        <Form.Item label="Submission Cell Placement">
                          <Button
                            icon={<HistoryOutlined />}
                            onClick={openCellAssignmentModal}
                            disabled={!editing}
                          >
                            View Submission History and Assign Active Cells
                          </Button>
                        </Form.Item>
                      </Col>
                    </Row>

                    <Form.Item
                      noStyle
                      dependencies={[
                        "numberOfCell",
                        "cellCapacities",
                        "cellStatuses",
                        "cellTypes",
                        "cellSubmissionAllowed",
                        "cellNotes",
                        "cellFillValues",
                        "cellCapacityUnits",
                        "cellFillUnits",
                      ]}
                    >
                      {() => {
                        const cellCount =
                          form.getFieldValue("numberOfCell") || 0;
                        if (cellCount < 1) return null;
                        return (
                          <>
                            <Divider
                              plain
                              orientation="left"
                              style={{ fontSize: 12, margin: "8px 0 12px" }}
                            >
                              Cell Capacities, Status &amp; Type
                            </Divider>
                            <Row gutter={[12, 12]}>
                              {Array.from({ length: cellCount }, (_, i) => {
                                const cellStatus = normalizeCellStatus(
                                  form.getFieldValue(["cellStatuses", i]),
                                );
                                const needsNote =
                                  cellStatus === "Under Construction" ||
                                  cellStatus === "Reserved Area" ||
                                  cellStatus === "Not Existed";
                                const sc =
                                  CELL_STATUS_COLORS[cellStatus] ||
                                  CELL_STATUS_COLORS["Active Cell"];
                                return (
                                  <Col span={8} key={i}>
                                    <Collapse
                                      size="small"
                                      bordered={false}
                                      defaultActiveKey={[]}
                                      destroyOnHidden
                                      expandIconPosition="end"
                                      style={{
                                        borderRadius: 8,
                                        borderLeft: `4px solid ${sc.border}`,
                                        background: isDark ? sc.dark : sc.bg,
                                      }}
                                      styles={{
                                        header: { padding: "8px 10px" },
                                        body: { padding: "10px 12px" },
                                      }}
                                      items={[
                                        {
                                          key: `cell-${i}`,
                                          label: (
                                            <Space size={6} wrap>
                                              <div
                                                style={{
                                                  width: 10,
                                                  height: 10,
                                                  borderRadius: "50%",
                                                  background: sc.border,
                                                  flexShrink: 0,
                                                }}
                                              />
                                              <Text
                                                strong
                                                style={{ fontSize: 12 }}
                                              >
                                                Cell {i + 1}
                                              </Text>
                                              <Tag
                                                color={sc.tag}
                                                style={{
                                                  fontSize: 10,
                                                  margin: 0,
                                                }}
                                              >
                                                {cellStatus}
                                              </Tag>
                                            </Space>
                                          ),
                                          children: (
                                            <>
                                      <Form.Item
                                        label="Capacity"
                                        style={{ marginBottom: 8 }}
                                      >
                                        <Space.Compact
                                          style={{ width: "100%" }}
                                        >
                                          <Form.Item
                                            name={["cellCapacities", i]}
                                            noStyle
                                          >
                                            <InputNumber
                                              style={{
                                                width: "calc(100% - 78px)",
                                              }}
                                              min={0}
                                              step={0.01}
                                              placeholder="Capacity"
                                            />
                                          </Form.Item>
                                          <Form.Item
                                            name={["cellCapacityUnits", i]}
                                            noStyle
                                            initialValue="m³"
                                          >
                                            <Select
                                              style={{ width: 78 }}
                                              options={UNIT_OPTIONS}
                                              onChange={(value) =>
                                                handleCellCapacityUnitChange(
                                                  i,
                                                  value,
                                                )
                                              }
                                            />
                                          </Form.Item>
                                        </Space.Compact>
                                      </Form.Item>
                                      <Form.Item
                                        label="Cell ON/OFF"
                                        style={{ marginBottom: 8 }}
                                      >
                                        <Switch
                                          checked={isActiveCellStatus(
                                            cellStatus,
                                          )}
                                          checkedChildren="ON"
                                          unCheckedChildren="OFF"
                                          onChange={(checked) => {
                                            const current =
                                              form.getFieldValue(
                                                "cellStatuses",
                                              ) || [];
                                            current[i] = checked
                                              ? "Active Cell"
                                              : "Used/Completed";
                                            form.setFieldsValue({
                                              cellStatuses: [...current],
                                            });
                                          }}
                                        />
                                      </Form.Item>
                                      <Form.Item
                                        name={["cellStatuses", i]}
                                        label="Status"
                                        initialValue="Active Cell"
                                        style={{ marginBottom: 8 }}
                                      >
                                        <Select options={CELL_STATUS_OPTIONS} />
                                      </Form.Item>
                                      {needsNote && (
                                        <Form.Item
                                          name={["cellNotes", i]}
                                          label="Notes"
                                          style={{ marginBottom: 8 }}
                                        >
                                          <Input.TextArea
                                            rows={2}
                                            placeholder={
                                              cellStatus ===
                                              "Under Construction"
                                                ? "Target completion date, contractor, current progress..."
                                                : "Planned use, estimated activation date, reserved for..."
                                            }
                                            style={{ resize: "none" }}
                                          />
                                        </Form.Item>
                                      )}
                                      <Form.Item
                                        name={["cellTypes", i]}
                                        label="Type"
                                        initialValue="Residual"
                                        style={{ marginBottom: 0 }}
                                      >
                                        <Select
                                          options={[
                                            {
                                              label: "Residual Cell",
                                              value: "Residual",
                                            },
                                            {
                                              label: "Treated Haz Waste Cell",
                                              value: "Treated Haz Waste",
                                            },
                                          ]}
                                        />
                                      </Form.Item>
                                      <Form.Item
                                        name={["cellSubmissionAllowed", i]}
                                        label={
                                          <Tooltip title="When ON, SLF/portal users can select this cell when disposing their volume-waste submissions in the Add Transport Entry form. Only Active/Open cells appear in the portal.">
                                            <span>
                                              Allow Portal Submissions{" "}
                                              <InfoCircleOutlined style={{ color: "#13c2c2" }} />
                                            </span>
                                          </Tooltip>
                                        }
                                        valuePropName="checked"
                                        initialValue={true}
                                        style={{ marginBottom: 0, marginTop: 8 }}
                                      >
                                        <Switch
                                          checkedChildren="Open"
                                          unCheckedChildren="Off"
                                          disabled={!isActiveCellStatus(cellStatus)}
                                        />
                                      </Form.Item>
                                      <Form.Item
                                        label="Waste in Cell"
                                        style={{
                                          marginBottom: 0,
                                          marginTop: 8,
                                        }}
                                      >
                                        <Space.Compact
                                          style={{ width: "100%" }}
                                        >
                                          <Form.Item
                                            name={["cellFillValues", i]}
                                            noStyle
                                          >
                                            <InputNumber
                                              style={{
                                                width: "calc(100% - 78px)",
                                              }}
                                              min={0}
                                              step={0.01}
                                              placeholder="Amount deposited"
                                              onChange={(value) =>
                                                handleCellFillValueChange(
                                                  i,
                                                  value,
                                                )
                                              }
                                            />
                                          </Form.Item>
                                          <Form.Item
                                            name={["cellFillUnits", i]}
                                            noStyle
                                            initialValue="m³"
                                          >
                                            <Select
                                              style={{ width: 78 }}
                                              options={UNIT_OPTIONS}
                                              onChange={(value) =>
                                                handleCellFillUnitChange(
                                                  i,
                                                  value,
                                                )
                                              }
                                            />
                                          </Form.Item>
                                        </Space.Compact>
                                      </Form.Item>
                                            </>
                                          ),
                                        },
                                      ]}
                                    />
                                  </Col>
                                );
                              })}
                            </Row>
                          </>
                        );
                      }}
                    </Form.Item>
                    <Form.Item
                      noStyle
                      dependencies={[
                        "numberOfCell",
                        "cellCapacities",
                        "cellCapacityUnits",
                        "cellStatuses",
                        "cellTypes",
                        "cellSubmissionAllowed",
                        "cellNotes",
                        "cellFillValues",
                        "cellFillUnits",
                        "volumeCapacity",
                        "actualResidualWasteReceived",
                        "wasteReceivedUnit",
                      ]}
                    >
                      {() => {
                        const cellCount =
                          form.getFieldValue("numberOfCell") || 0;
                        const caps = form.getFieldValue("cellCapacities") || [];
                        const capUnits =
                          form.getFieldValue("cellCapacityUnits") || [];
                        const statuses =
                          form.getFieldValue("cellStatuses") || [];
                        const types = form.getFieldValue("cellTypes") || [];
                        const cellNotes = form.getFieldValue("cellNotes") || [];
                        const fills =
                          form.getFieldValue("cellFillValues") || [];
                        const fillUnits =
                          form.getFieldValue("cellFillUnits") || [];
                        const cellDisplayUnit = normalizeUnit(
                          form.getFieldValue("wasteReceivedUnit") ||
                            form.getFieldValue("volumeCapacityUnit") ||
                            capUnits.find(Boolean) ||
                            fillUnits.find(Boolean) ||
                            form.getFieldValue("wasteReceivedUnit") ||
                            "m³",
                        );
                        const cellCapacityTotal = Array.from(
                          { length: cellCount },
                          (_, index) =>
                            convertVolume(
                              caps[index] || 0,
                              capUnits[index] || cellDisplayUnit,
                              cellDisplayUnit,
                            ),
                        ).reduce((sum, value) => sum + value, 0);
                        const cellFillTotal = Array.from(
                          { length: cellCount },
                          (_, index) => {
                            const fill = fills[index];
                            if (fill == null) return 0;
                            return convertVolume(
                              fill,
                              fillUnits[index] || cellDisplayUnit,
                              cellDisplayUnit,
                            );
                          },
                        ).reduce((sum, value) => sum + value, 0);
                        const fallbackCapacity = convertVolume(
                          form.getFieldValue("volumeCapacity") || 0,
                          form.getFieldValue("volumeCapacityUnit") || cellDisplayUnit,
                          cellDisplayUnit,
                        );
                        const fallbackWaste = convertVolume(
                          form.getFieldValue("actualResidualWasteReceived") || 0,
                          form.getFieldValue("wasteReceivedUnit") || cellDisplayUnit,
                          cellDisplayUnit,
                        );
                        const totalCap = cellCapacityTotal || fallbackCapacity;
                        const wasteRaw = cellFillTotal || fallbackWaste;
                        const wasteUnit = cellDisplayUnit;
                        const pct =
                          totalCap > 0
                            ? Math.min(
                                Math.round((wasteRaw / totalCap) * 100),
                                100,
                              )
                            : 0;
                        if (cellCount < 1)
                          return (
                            <Empty description="Select number of cells to see infrastructure preview" />
                          );

                        const STATUS_STROKE = {
                          "Active Cell": (p) =>
                            p >= 90
                              ? "#ff4d4f"
                              : p >= 70
                                ? "#faad14"
                                : "#52c41a",
                          "Used/Completed": () => "#8c8c8c",
                          "Under Construction": () => "#fa8c16",
                          "Reserved Area": () => "#722ed1",
                          "Not Existed": () => "#bfbfbf",
                        };
                        const STATUS_TAG = Object.fromEntries(
                          Object.entries(CELL_STATUS_COLORS).map(
                            ([key, value]) => [key, value.tag],
                          ),
                        );

                        // Use per-cell fill values; fall back to overall pct if no fill entered for the cell
                        const cellDonutData = Array.from(
                          { length: cellCount },
                          (_, i) => {
                            const cap = caps[i] || 0;
                            const capUnit = normalizeUnit(capUnits[i] || "m³");
                            const st = normalizeCellStatus(statuses[i]);
                            const ty = types[i] || "Residual";
                            const note = cellNotes[i] || "";
                            const isInactive = !isActiveCellStatus(st);
                            const fillRaw = fills[i] != null ? fills[i] : null;
                            const fillUnit = normalizeUnit(
                              fillUnits[i] || capUnit,
                            );
                            const fillInCapacityUnit =
                              fillRaw != null
                                ? convertVolume(fillRaw, fillUnit, capUnit)
                                : null;
                            let displayPct = 0;
                            let usedInCapacityUnit = 0;
                            if (!isInactive) {
                              if (fillInCapacityUnit != null && cap > 0) {
                                usedInCapacityUnit = fillInCapacityUnit;
                                displayPct = Math.min(
                                  Math.round((fillInCapacityUnit / cap) * 100),
                                  100,
                                );
                              } else if (cap > 0) {
                                displayPct = pct;
                                usedInCapacityUnit = (pct / 100) * cap;
                              }
                            }
                            return {
                              index: i,
                              capacity: cap,
                              capacityUnit: capUnit,
                              fillUnit,
                              status: st,
                              cellType: ty,
                              note,
                              pct: displayPct,
                              used: Math.min(usedInCapacityUnit, cap),
                              remaining: Math.max(
                                0,
                                cap - Math.min(usedInCapacityUnit, cap),
                              ),
                              hasCellFill: fillRaw != null,
                            };
                          },
                        );

                        return (
                          <Card
                            size="small"
                            style={{
                              borderRadius: 10,
                              marginTop: 8,
                              background: isDark ? "#1f1f1f" : "#fafafa",
                            }}
                          >
                            {/* Overall facility gauge + per-cell gauges */}
                            <Row gutter={16} align="middle">
                              <Col
                                xs={24}
                                md={6}
                                style={{ textAlign: "center" }}
                              >
                                <Progress
                                  type="dashboard"
                                  percent={pct}
                                  size={110}
                                  strokeLinecap="butt"
                                  strokeColor={
                                    pct >= 90
                                      ? "#ff4d4f"
                                      : pct >= 70
                                        ? "#faad14"
                                        : "#52c41a"
                                  }
                                  format={() => (
                                    <div style={{ lineHeight: 1.3 }}>
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
                                        overall
                                      </div>
                                    </div>
                                  )}
                                />
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: "#8c8c8c",
                                    marginTop: 4,
                                  }}
                                >
                                  {wasteRaw > 0
                                    ? wasteRaw.toLocaleString()
                                    : "0"}{" "}
                                  {cellDisplayUnit} /{" "}
                                  {totalCap > 0
                                    ? totalCap.toLocaleString()
                                    : "—"}{" "}
                                  {cellDisplayUnit}
                                  {cellDisplayUnit === "tons" && wasteRaw > 0 && (
                                    <div
                                      style={{ fontSize: 10, color: "#8c8c8c" }}
                                    >
                                      approx.{" "}
                                      {convertVolume(wasteRaw, wasteUnit, "m³").toLocaleString(undefined, {
                                        maximumFractionDigits: 0,
                                      })}{" "}
                                      m³ (at 0.20 t/m³)
                                    </div>
                                  )}
                                </div>
                              </Col>
                              <Col xs={24} md={18}>
                                {(() => {
                                  const residualGauges = cellDonutData.filter(
                                    (c) => c.cellType !== "Treated Haz Waste",
                                  );
                                  const hazGauges = cellDonutData.filter(
                                    (c) => c.cellType === "Treated Haz Waste",
                                  );
                                  const renderGaugeGroup = (cells) => (
                                    <Row gutter={[8, 8]} justify="start">
                                      {cells.map((cell) => {
                                        const isInactive = !isActiveCellStatus(
                                          cell.status,
                                        );
                                        const isHaz =
                                          cell.cellType === "Treated Haz Waste";
                                        const strokeFn =
                                          STATUS_STROKE[cell.status] ||
                                          STATUS_STROKE["Active Cell"];
                                        const strokeColor = isInactive
                                          ? strokeFn(0)
                                          : isHaz
                                            ? "#f5222d"
                                            : strokeFn(cell.pct);
                                        const tagColor =
                                          STATUS_TAG[cell.status] || "default";
                                        return (
                                          <Col
                                            xs={12}
                                            sm={8}
                                            md={6}
                                            key={cell.index}
                                            style={{ textAlign: "center" }}
                                          >
                                            <Progress
                                              type="dashboard"
                                              percent={
                                                isInactive ? 0 : cell.pct
                                              }
                                              size={65}
                                              strokeLinecap="butt"
                                              strokeColor={strokeColor}
                                              trailColor={
                                                isCompletedCellStatus(
                                                  cell.status,
                                                )
                                                  ? "#bfbfbf"
                                                  : undefined
                                              }
                                              format={() => (
                                                <div
                                                  style={{ lineHeight: 1.2 }}
                                                >
                                                  <div
                                                    style={{
                                                      fontSize: 11,
                                                      fontWeight: 700,
                                                      color: strokeColor,
                                                    }}
                                                  >
                                                    {isCompletedCellStatus(
                                                      cell.status,
                                                    )
                                                      ? "Done"
                                                      : isInactive
                                                        ? "—"
                                                        : `${cell.pct}%`}
                                                  </div>
                                                </div>
                                              )}
                                            />
                                            <div
                                              style={{
                                                fontSize: 11,
                                                fontWeight: 600,
                                                marginTop: 2,
                                              }}
                                            >
                                              Cell {cell.index + 1}
                                            </div>
                                            <Tag
                                              color={tagColor}
                                              style={{
                                                fontSize: 9,
                                                marginTop: 2,
                                                marginBottom: 2,
                                              }}
                                            >
                                              {cell.status}
                                            </Tag>
                                            <Tag
                                              color={isHaz ? "red" : "blue"}
                                              style={{
                                                fontSize: 9,
                                                marginBottom: 2,
                                              }}
                                            >
                                              {isHaz ? "Haz" : "Res"}
                                            </Tag>
                                            <div
                                              style={{
                                                fontSize: 10,
                                                color: "#8c8c8c",
                                              }}
                                            >
                                              {cell.capacity > 0
                                                ? `${cell.capacity.toLocaleString()} ${cell.capacityUnit}`
                                                : "—"}
                                            </div>
                                            {cell.hasCellFill &&
                                              cell.used > 0 && (
                                                <div
                                                  style={{
                                                    fontSize: 9,
                                                    color: "#1677ff",
                                                  }}
                                                >
                                                  {cell.used.toLocaleString()}{" "}
                                                  {cell.capacityUnit} filled
                                                </div>
                                              )}
                                            {cell.note && (
                                              <Tooltip title={cell.note}>
                                                <div
                                                  style={{
                                                    fontSize: 9,
                                                    color: "#595959",
                                                    fontStyle: "italic",
                                                    marginTop: 2,
                                                    maxWidth: 80,
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    whiteSpace: "nowrap",
                                                  }}
                                                >
                                                  {cell.note}
                                                </div>
                                              </Tooltip>
                                            )}
                                          </Col>
                                        );
                                      })}
                                    </Row>
                                  );
                                  return (
                                    <>
                                      {residualGauges.length > 0 && (
                                        <>
                                          {hazGauges.length > 0 && (
                                            <div
                                              style={{
                                                fontSize: 10,
                                                fontWeight: 600,
                                                color: "#1677ff",
                                                marginBottom: 4,
                                              }}
                                            >
                                              Residual Cells
                                            </div>
                                          )}
                                          {renderGaugeGroup(residualGauges)}
                                        </>
                                      )}
                                      {hazGauges.length > 0 && (
                                        <>
                                          <div
                                            style={{
                                              fontSize: 10,
                                              fontWeight: 600,
                                              color: "#f5222d",
                                              marginTop:
                                                residualGauges.length > 0
                                                  ? 8
                                                  : 0,
                                              marginBottom: 4,
                                            }}
                                          >
                                            Treated Haz Waste Cells
                                          </div>
                                          {renderGaugeGroup(hazGauges)}
                                        </>
                                      )}
                                    </>
                                  );
                                })()}
                              </Col>
                            </Row>

                            {/* Per-cell donut breakdown — grouped by cell type */}
                            {cellCount >= 2 &&
                              cellDonutData.some((c) => c.capacity > 0) &&
                              (() => {
                                const residualDonuts = cellDonutData.filter(
                                  (c) =>
                                    c.capacity > 0 &&
                                    c.cellType !== "Treated Haz Waste",
                                );
                                const hazDonuts = cellDonutData.filter(
                                  (c) =>
                                    c.capacity > 0 &&
                                    c.cellType === "Treated Haz Waste",
                                );
                                const renderDonutGroup = (cells) => (
                                  <Row gutter={[4, 4]} justify="center">
                                    {cells.map((cell) => {
                                      const isInactive = !isActiveCellStatus(
                                        cell.status,
                                      );
                                      const isHaz =
                                        cell.cellType === "Treated Haz Waste";
                                      const chartData = isInactive
                                        ? [
                                            {
                                              name: cell.status,
                                              value: cell.capacity,
                                            },
                                          ]
                                        : cell.used > 0
                                          ? [
                                              {
                                                name: "Used",
                                                value: cell.used,
                                              },
                                              {
                                                name: "Remaining",
                                                value: cell.remaining,
                                              },
                                            ]
                                          : [
                                              {
                                                name: "Empty",
                                                value: cell.capacity,
                                              },
                                            ];
                                      const inactiveColor =
                                        isCompletedCellStatus(cell.status)
                                          ? "#d9d9d9"
                                          : cell.status === "Under Construction"
                                            ? "#fa8c16"
                                            : cell.status === "Reserved Area"
                                              ? "#722ed1"
                                              : "#bfbfbf";
                                      const colors = isInactive
                                        ? [inactiveColor]
                                        : isHaz
                                          ? ["#f5222d", "#d9d9d9"]
                                          : ["#ff4d4f", "#52c41a"];
                                      return (
                                        <Col
                                          xs={12}
                                          sm={8}
                                          md={6}
                                          key={cell.index}
                                          style={{ textAlign: "center" }}
                                        >
                                          <Text
                                            style={{
                                              fontSize: 11,
                                              fontWeight: 600,
                                            }}
                                          >
                                            Cell {cell.index + 1}
                                          </Text>
                                          <PieChart width={110} height={88}>
                                            <Pie
                                              data={chartData}
                                              cx={55}
                                              cy={44}
                                              innerRadius={20}
                                              outerRadius={36}
                                              paddingAngle={
                                                chartData.length > 1 ? 2 : 0
                                              }
                                              dataKey="value"
                                              isAnimationActive={false}
                                              animationBegin={80}
                                              animationDuration={650}
                                            >
                                              {chartData.map((_, j) => (
                                                <RCell
                                                  key={j}
                                                  fill={
                                                    colors[j % colors.length]
                                                  }
                                                />
                                              ))}
                                            </Pie>
                                            <RTooltip
                                              formatter={(v) =>
                                                `${Number(v).toLocaleString()} ${cell.capacityUnit}`
                                              }
                                            />
                                          </PieChart>
                                        </Col>
                                      );
                                    })}
                                  </Row>
                                );
                                return (
                                  <>
                                    <Divider
                                      plain
                                      style={{
                                        fontSize: 11,
                                        margin: "10px 0 6px",
                                      }}
                                    >
                                      Per-Cell Capacity Breakdown
                                    </Divider>
                                    {residualDonuts.length > 0 && (
                                      <>
                                        {hazDonuts.length > 0 && (
                                          <Divider
                                            plain
                                            style={{
                                              fontSize: 10,
                                              margin: "6px 0 4px",
                                              borderColor: "#1677ff",
                                            }}
                                          >
                                            <span style={{ color: "#1677ff" }}>
                                              Residual Cells
                                            </span>
                                          </Divider>
                                        )}
                                        {renderDonutGroup(residualDonuts)}
                                      </>
                                    )}
                                    {hazDonuts.length > 0 && (
                                      <>
                                        <Divider
                                          plain
                                          style={{
                                            fontSize: 10,
                                            margin: "8px 0 4px",
                                            borderColor: "#f5222d",
                                          }}
                                        >
                                          <span style={{ color: "#f5222d" }}>
                                            Treated Haz Waste Cells
                                          </span>
                                        </Divider>
                                        {renderDonutGroup(hazDonuts)}
                                      </>
                                    )}
                                  </>
                                );
                              })()}
                          </Card>
                        );
                      }}
                    </Form.Item>
                  </>
                ),
              },
              {
                key: "permits",
                label: (
                  <span style={{ color: "#faad14" }}>
                    <SafetyCertificateOutlined /> Permits
                  </span>
                ),
                children: (
                  <>
                    <Row gutter={[12, 0]}>
                      <Col span={12}>
                        <Form.Item name="eccNo" label="ECC No.">
                          <Input placeholder="Environmental Compliance Certificate number" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          name="hazwasteGenerationId"
                          label="Hazwaste Gen. ID"
                        >
                          <Input placeholder="Hazardous Waste Generation ID" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider
                      orientation="left"
                      plain
                      style={{ margin: "4px 0 12px", fontSize: 12 }}
                    >
                      <SafetyCertificateOutlined
                        style={{ color: "#1677ff", marginRight: 6 }}
                      />
                      Discharge Permits
                    </Divider>
                    <Form.List name="dischargePermits">
                      {(fields, { add, remove }) => (
                        <>
                          <Table
                            size="small"
                            pagination={false}
                            dataSource={fields}
                            rowKey="key"
                            locale={{
                              emptyText: "No discharge permits added yet",
                            }}
                            columns={[
                              {
                                title: "Permit No.",
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "permitNo"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Input
                                      size="small"
                                      placeholder="Permit number"
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "DP Type",
                                width: 150,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "permitType"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Select
                                      size="small"
                                      allowClear
                                      placeholder="Type"
                                      options={DP_TYPE_OPTIONS}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Validity",
                                width: 170,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "validity"]}
                                    style={{ margin: 0 }}
                                  >
                                    <DatePicker
                                      size="small"
                                      format="MM/DD/YYYY"
                                      style={{ width: "100%" }}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Status",
                                width: 140,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "status"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Select
                                      size="small"
                                      allowClear
                                      placeholder="Status"
                                      options={PERMIT_STATUS_OPTIONS}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "",
                                width: 48,
                                render: (_, field) => (
                                  <Button
                                    size="small"
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => remove(field.name)}
                                  />
                                ),
                              },
                            ]}
                          />
                          <Button
                            type="dashed"
                            onClick={() => add({})}
                            block
                            icon={<PlusOutlined />}
                            size="small"
                            style={{ marginTop: 8 }}
                          >
                            Add Discharge Permit
                          </Button>
                        </>
                      )}
                    </Form.List>
                    <Divider
                      orientation="left"
                      plain
                      style={{ margin: "16px 0 12px", fontSize: 12 }}
                    >
                      <SafetyCertificateOutlined
                        style={{ color: "#52c41a", marginRight: 6 }}
                      />
                      Permits to Operate
                    </Divider>
                    <Form.List name="permitToOperatePermits">
                      {(fields, { add, remove }) => (
                        <>
                          <Table
                            size="small"
                            pagination={false}
                            dataSource={fields}
                            rowKey="key"
                            locale={{
                              emptyText: "No permits to operate added yet",
                            }}
                            columns={[
                              {
                                title: "Permit No.",
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "permitNo"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Input
                                      size="small"
                                      placeholder="Permit number"
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Validity",
                                width: 170,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "validity"]}
                                    style={{ margin: 0 }}
                                  >
                                    <DatePicker
                                      size="small"
                                      format="MM/DD/YYYY"
                                      style={{ width: "100%" }}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Status",
                                width: 140,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "status"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Select
                                      size="small"
                                      allowClear
                                      placeholder="Status"
                                      options={PERMIT_STATUS_OPTIONS}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "",
                                width: 48,
                                render: (_, field) => (
                                  <Button
                                    size="small"
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => remove(field.name)}
                                  />
                                ),
                              },
                            ]}
                          />
                          <Button
                            type="dashed"
                            onClick={() => add({})}
                            block
                            icon={<PlusOutlined />}
                            size="small"
                            style={{ marginTop: 8 }}
                          >
                            Add Permit to Operate
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </>
                ),
              },
              {
                key: "personnel-monitoring",
                label: (
                  <span style={{ color: "#52c41a" }}>
                    <TeamOutlined /> Personnel &amp; Monitoring
                  </span>
                ),
                children: (
                  <>
                    <Row gutter={12}>
                      <Col span={8}>
                        <Form.Item name="targetMonth" label="Target Month">
                          <Select
                            options={monthOptions}
                            placeholder="Select"
                            allowClear
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="enmo" label="ENMO">
                          <Select
                            options={enmoOptions}
                            allowClear
                            showSearch
                            placeholder="Select ENMO"
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="focalPerson" label="ESWM Focal Person">
                          <Select
                            options={focalOptions}
                            allowClear
                            showSearch
                            placeholder="Select ESWM focal person"
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="iisNumber" label="IIS Number">
                          <Input />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider
                      plain
                      orientation="left"
                      style={{ fontSize: 12, margin: "4px 0 12px" }}
                    >
                      <CalendarOutlined /> Monitoring Dates
                    </Divider>
                    <Row gutter={12}>
                      <Col span={8}>
                        <Form.Item name="dateOfMonitoring" label="Monitoring">
                          <DatePicker
                            format="MM/DD/YYYY"
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          name="dateReportPrepared"
                          label="Report Prepared"
                        >
                          <DatePicker
                            format="MM/DD/YYYY"
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          name="dateReportReviewedStaff"
                          label="Reviewed By Staff"
                        >
                          <DatePicker
                            format="MM/DD/YYYY"
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          name="dateReportReviewedFocal"
                          label="Reviewed By ESWM Focal Person"
                        >
                          <DatePicker
                            format="MM/DD/YYYY"
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="dateReportApproved" label="Approved">
                          <DatePicker
                            format="MM/DD/YYYY"
                            style={{ width: "100%" }}
                          />
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
                    <FileTextOutlined /> Compliance
                  </span>
                ),
                children: (
                  <Row gutter={12}>
                    <Col span={12}>
                      <Form.Item
                        name="findings"
                        label="Other Findings and Observations"
                      >
                        <Input.TextArea rows={3} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item
                        name="remarksAndRecommendation"
                        label="Remarks and Recommendation"
                      >
                        <Input.TextArea rows={3} />
                      </Form.Item>
                    </Col>
                    <Col span={24}>
                      <Form.Item
                        name="technicalConferenceConducted"
                        valuePropName="checked"
                        style={{ marginBottom: 8 }}
                      >
                        <Checkbox>Technical Conference conducted</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item
                        name="commitmentFiles"
                        label="Commitment File"
                        valuePropName="fileList"
                        getValueFromEvent={(e) =>
                          Array.isArray(e) ? e : e?.fileList
                        }
                      >
                        <Upload
                          {...slfUploadProps}
                          action="/eswm-pipeline/api/upload"
                          headers={getUploadHeaders()}
                          multiple
                          accept=".pdf,.doc,.docx,.xls,.xlsx,image/*"
                        >
                          <Button icon={<UploadOutlined />}>
                            Upload Commitment File (max 200 MB)
                          </Button>
                        </Upload>
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item
                        name="progressReportFiles"
                        label="Progress Report"
                        valuePropName="fileList"
                        getValueFromEvent={(e) =>
                          Array.isArray(e) ? e : e?.fileList
                        }
                      >
                        <Upload
                          {...slfUploadProps}
                          action="/eswm-pipeline/api/upload"
                          headers={getUploadHeaders()}
                          multiple
                          accept=".pdf,.doc,.docx,.xls,.xlsx,image/*"
                        >
                          <Button icon={<UploadOutlined />}>
                            Upload Progress Report (max 200 MB)
                          </Button>
                        </Upload>
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "preventive",
                label: (
                  <span style={{ color: "#fa8c16" }}>
                    <WarningOutlined /> Preventive Measures
                  </span>
                ),
                children: (
                  <>
                    <Divider orientation="left" plain>
                      Preventive Measure Files
                    </Divider>
                    <Form.Item
                      name="preventiveMeasureFiles"
                      valuePropName="fileList"
                      getValueFromEvent={(e) =>
                        Array.isArray(e) ? e : e?.fileList
                      }
                    >
                      <Upload
                        {...slfUploadProps}
                        action="/eswm-pipeline/api/upload"
                        headers={getUploadHeaders()}
                        multiple
                        accept=".pdf,.doc,.docx,.xls,.xlsx,image/*"
                      >
                        <Button icon={<UploadOutlined />}>
                          Upload Preventive Measure Files (max 200 MB)
                        </Button>
                      </Upload>
                    </Form.Item>
                    <Divider orientation="left" plain style={{ marginTop: 16 }}>
                      Safe Closure and Rehabilitation Plan (SCRP)
                    </Divider>
                    <Form.List name="scrpDetails">
                      {(fields, { add, remove }) => (
                        <>
                          <Table
                            size="small"
                            pagination={false}
                            dataSource={fields}
                            rowKey="key"
                            locale={{ emptyText: "No SCRP entries yet" }}
                            columns={[
                              {
                                title: "Plan / Activity",
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "planTitle"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Input
                                      size="small"
                                      placeholder="SCRP plan or activity"
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Status",
                                width: 160,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "status"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Select
                                      size="small"
                                      allowClear
                                      options={[
                                        "Prepared",
                                        "For Revision",
                                        "Submitted",
                                        "Approved",
                                        "Implemented",
                                      ].map((value) => ({
                                        label: value,
                                        value,
                                      }))}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Remarks",
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "remarks"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Input size="small" placeholder="Remarks" />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Upload",
                                width: 230,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "attachments"]}
                                    valuePropName="fileList"
                                    getValueFromEvent={(e) =>
                                      Array.isArray(e) ? e : e?.fileList
                                    }
                                    style={{ margin: 0 }}
                                  >
                                    <Upload
                                      {...slfUploadProps}
                                      action="/eswm-pipeline/api/upload"
                                      headers={getUploadHeaders()}
                                      multiple
                                      accept=".pdf,.doc,.docx,.xls,.xlsx,image/*"
                                    >
                                      <Button
                                        size="small"
                                        icon={<UploadOutlined />}
                                      >
                                        Upload (max 200 MB)
                                      </Button>
                                    </Upload>
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "",
                                width: 48,
                                render: (_, field) => (
                                  <Button
                                    size="small"
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => remove(field.name)}
                                  />
                                ),
                              },
                            ]}
                          />
                          <Button
                            type="dashed"
                            onClick={() => add({})}
                            block
                            icon={<PlusOutlined />}
                            size="small"
                            style={{ marginTop: 8 }}
                          >
                            Add SCRP Entry
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </>
                ),
              },
              {
                key: "gallery",
                label: (
                  <span style={{ color: "#1677ff" }}>
                    <FileImageOutlined /> Gallery
                  </span>
                ),
                children: (
                  <>
                    <Divider orientation="left" plain>
                      SLF Component Gallery
                    </Divider>
                    <Form.List name="galleryItems">
                      {(fields, { add, remove }) => (
                        <>
                          {fields.map(({ key, name, ...rest }) => (
                            <Card
                              key={key}
                              size="small"
                              style={{ marginBottom: 10, borderRadius: 8 }}
                              extra={
                                <Button
                                  size="small"
                                  type="text"
                                  danger
                                  icon={<DeleteOutlined />}
                                  onClick={() => remove(name)}
                                />
                              }
                            >
                              <Row gutter={[12, 0]}>
                                <Col span={8}>
                                  <Form.Item
                                    {...rest}
                                    name={[name, "component"]}
                                    label="SLF Component"
                                  >
                                    <Select
                                      allowClear
                                      showSearch
                                      placeholder="Select component"
                                      options={GALLERY_COMPONENT_OPTIONS}
                                    />
                                  </Form.Item>
                                </Col>
                                <Col span={8}>
                                  <Form.Item
                                    {...rest}
                                    name={[name, "folder"]}
                                    label="Folder"
                                  >
                                    <Select
                                      mode="tags"
                                      maxTagCount={1}
                                      placeholder="Create or select folder"
                                      tokenSeparators={[","]}
                                    />
                                  </Form.Item>
                                </Col>
                                <Col span={8}>
                                  <Form.Item
                                    {...rest}
                                    name={[name, "caption"]}
                                    label="Caption"
                                  >
                                    <Input placeholder="Photo caption" />
                                  </Form.Item>
                                </Col>
                                <Col span={24}>
                                  <Form.Item
                                    {...rest}
                                    name={[name, "url"]}
                                    label="Photo"
                                    valuePropName="fileList"
                                    getValueFromEvent={(e) =>
                                      Array.isArray(e) ? e : e?.fileList
                                    }
                                  >
                                    <Upload
                                      {...slfUploadProps}
                                      listType="picture-card"
                                      maxCount={1}
                                      accept="image/*"
                                      action="/eswm-pipeline/api/upload"
                                      headers={getUploadHeaders()}
                                    >
                                      <div>
                                        <PlusOutlined />
                                        <div
                                          style={{ marginTop: 8, fontSize: 12 }}
                                        >
                                          Upload Photo
                                          <br />
                                          <Text type="secondary" style={{ fontSize: 11 }}>
                                            Max 200 MB
                                          </Text>
                                        </div>
                                      </div>
                                    </Upload>
                                  </Form.Item>
                                </Col>
                              </Row>
                            </Card>
                          ))}
                          <Button
                            type="dashed"
                            onClick={() => add({})}
                            block
                            icon={<PlusOutlined />}
                          >
                            Add Gallery Item
                          </Button>
                        </>
                      )}
                    </Form.List>
                    <Divider orientation="left" plain style={{ marginTop: 16 }}>
                      Legacy Photo Uploads
                    </Divider>
                    <Form.Item
                      name="galleryPhotos"
                      valuePropName="fileList"
                      getValueFromEvent={(e) =>
                        Array.isArray(e) ? e : e?.fileList
                      }
                    >
                      <Upload
                        {...slfUploadProps}
                        listType="picture-card"
                        accept="image/*"
                        multiple
                        action="/eswm-pipeline/api/upload"
                        headers={getUploadHeaders()}
                      >
                        <div>
                          <PlusOutlined />
                          <div style={{ marginTop: 8, fontSize: 12 }}>
                            Upload Photo
                            <br />
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              Max 200 MB
                            </Text>
                          </div>
                        </div>
                      </Upload>
                    </Form.Item>
                  </>
                ),
              },
              {
                key: "documents",
                label: (
                  <span style={{ color: "#722ed1" }}>
                    <FolderOutlined /> Documents
                  </span>
                ),
                children: (
                  <>
                    <Divider orientation="left" plain>
                      SLF Documents
                    </Divider>
                    <Form.List name="slfDocuments">
                      {(fields, { add, remove }) => (
                        <>
                          {fields.map(({ key, name, ...rest }) => (
                            <Card
                              key={key}
                              size="small"
                              style={{ marginBottom: 10, borderRadius: 8 }}
                              extra={
                                <MinusCircleOutlined
                                  style={{
                                    color: "#ff4d4f",
                                    cursor: "pointer",
                                  }}
                                  onClick={() => remove(name)}
                                />
                              }
                            >
                              <Row gutter={[12, 0]}>
                                <Col xs={24} sm={10}>
                                  <Form.Item
                                    {...rest}
                                    name={[name, "title"]}
                                    label="Title"
                                    rules={[
                                      {
                                        required: true,
                                        message: "Title required",
                                      },
                                    ]}
                                  >
                                    <Input placeholder="Document title" />
                                  </Form.Item>
                                </Col>
                                <Col xs={24} sm={14}>
                                  <Form.Item
                                    {...rest}
                                    name={[name, "docType"]}
                                    label="Document Type"
                                  >
                                    <Select
                                      allowClear
                                      placeholder="Select type"
                                      options={[
                                        { label: "ECC", value: "ECC" },
                                        { label: "Permit", value: "Permit" },
                                        {
                                          label: "Monitoring Report",
                                          value: "Monitoring Report",
                                        },
                                        {
                                          label: "Compliance Certificate",
                                          value: "Compliance Certificate",
                                        },
                                        {
                                          label: "Site Plan",
                                          value: "Site Plan",
                                        },
                                        { label: "Other", value: "Other" },
                                      ]}
                                    />
                                  </Form.Item>
                                </Col>
                                <Col xs={24}>
                                  <Form.Item
                                    {...rest}
                                    name={[name, "description"]}
                                    label="Description"
                                  >
                                    <Input placeholder="Brief description of the document" />
                                  </Form.Item>
                                </Col>
                                <Col xs={24}>
                                  <Form.Item
                                    {...rest}
                                    name={[name, "url"]}
                                    label="File"
                                    valuePropName="fileList"
                                    getValueFromEvent={(e) =>
                                      Array.isArray(e) ? e : e?.fileList
                                    }
                                  >
                                    <Upload
                                      {...slfUploadProps}
                                      maxCount={1}
                                      accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                                      action="/eswm-pipeline/api/upload"
                                      headers={getUploadHeaders()}
                                    >
                                      <Button icon={<FilePdfOutlined />}>
                                        Upload Document (max 200 MB)
                                      </Button>
                                    </Upload>
                                  </Form.Item>
                                </Col>
                              </Row>
                            </Card>
                          ))}
                          <Button
                            type="dashed"
                            onClick={() =>
                              add({ docType: "Monitoring Report" })
                            }
                            block
                            icon={<PlusOutlined />}
                          >
                            Add Document
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </>
                ),
              },
            ]}
          />
          </Form>
        </Spin>
      </Modal>

      <Modal
        title={
          <Space>
            <EnvironmentOutlined />
            <span>{mapPreview?.label || "SLF Location"}</span>
          </Space>
        }
        open={!!mapPreview}
        onCancel={() => setMapPreview(null)}
        footer={
          <Space>
            {mapPreview && (
              <Button
                icon={<LinkOutlined />}
                href={`https://www.google.com/maps/search/?api=1&query=${mapPreview.latitude},${mapPreview.longitude}`}
                target="_blank"
                rel="noreferrer"
              >
                Open Google Maps
              </Button>
            )}
            <Button onClick={() => setMapPreview(null)}>Close</Button>
          </Space>
        }
        width={820}
        destroyOnHidden
      >
        {mapPreview && (
          <div>
            <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
              {mapPreview.latitude}, {mapPreview.longitude}
            </Text>
            <iframe
              title="SLF map preview"
              src={`https://maps.google.com/maps?q=${mapPreview.latitude},${mapPreview.longitude}&z=16&output=embed`}
              style={{
                width: "100%",
                height: 420,
                border: 0,
                borderRadius: 8,
              }}
              loading="lazy"
            />
          </div>
        )}
      </Modal>

      {/* -- Capacity Converter Modal -- */}
      <Modal
        title={
          <Space>
            <CalculatorOutlined style={{ color: ACCENT }} />
            <span>Capacity Converter</span>
          </Space>
        }
        open={convModalOpen}
        onCancel={() => setConvModalOpen(false)}
        footer={<Button onClick={() => setConvModalOpen(false)}>Close</Button>}
        width={680}
        zIndex={1600}
        destroyOnHidden={false}
      >
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Text type="secondary">
            Convert common SLF capacity values. Each result can be copied for
            quick encoding in the form.
          </Text>

          <Card size="small" title="Area x Depth = Volume">
            <Row gutter={[12, 12]} align="middle">
              <Col xs={24} sm={10} md={7}>
                <Text type="secondary">Area</Text>
                <Space.Compact style={{ width: "100%", marginTop: 4 }}>
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    step={0.01}
                    placeholder="0.00"
                    value={convArea}
                    onChange={setConvArea}
                  />
                  <span className="ant-input-group-addon">m2</span>
                </Space.Compact>
              </Col>
              <Col xs={24} sm={4} md={2} style={{ textAlign: "center" }}>
                <Text strong>x</Text>
              </Col>
              <Col xs={24} sm={10} md={7}>
                <Text type="secondary">Depth</Text>
                <Space.Compact style={{ width: "100%", marginTop: 4 }}>
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    step={0.01}
                    placeholder="0.00"
                    value={convDepth}
                    onChange={setConvDepth}
                  />
                  <span className="ant-input-group-addon">m</span>
                </Space.Compact>
              </Col>
              <Col xs={24} md={8}>
                <Text type="secondary">Volume</Text>
                <Input
                  readOnly
                  value={
                    convArea != null && convDepth != null
                      ? `${(convArea * convDepth).toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })} m3`
                      : ""
                  }
                  placeholder="Result"
                  style={{ marginTop: 4, fontWeight: 600, color: "#389e0d" }}
                  addonAfter={
                    <Tooltip title="Copy volume">
                      <Button
                        size="small"
                        type="text"
                        icon={<CopyOutlined />}
                        disabled={convArea == null || convDepth == null}
                        onClick={() =>
                          copyText(
                            `${(convArea * convDepth).toLocaleString(
                              undefined,
                              { maximumFractionDigits: 2 },
                            )} m3`,
                            "Volume",
                          )
                        }
                      />
                    </Tooltip>
                  }
                />
              </Col>
            </Row>
          </Card>

          <Card size="small" title="Volume x Density = Weight">
            <Row gutter={[12, 12]} align="middle">
              <Col xs={24} sm={10} md={7}>
                <Text type="secondary">Volume</Text>
                <Space.Compact style={{ width: "100%", marginTop: 4 }}>
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    step={0.01}
                    placeholder="0.00"
                    value={convVol}
                    onChange={setConvVol}
                  />
                  <span className="ant-input-group-addon">m3</span>
                </Space.Compact>
              </Col>
              <Col xs={24} sm={4} md={2} style={{ textAlign: "center" }}>
                <Text strong>x</Text>
              </Col>
              <Col xs={24} sm={10} md={7}>
                <Text type="secondary">Density</Text>
                <Space.Compact style={{ width: "100%", marginTop: 4 }}>
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    step={0.001}
                    placeholder="0.20"
                    value={convDensity}
                    onChange={setConvDensity}
                  />
                  <span className="ant-input-group-addon">t/m3</span>
                </Space.Compact>
              </Col>
              <Col xs={24} md={8}>
                <Text type="secondary">Weight</Text>
                <Input
                  readOnly
                  value={
                    convVol != null && convDensity != null
                      ? `${(convVol * convDensity).toLocaleString(undefined, {
                          maximumFractionDigits: 3,
                        })} tons`
                      : ""
                  }
                  placeholder="Result"
                  style={{ marginTop: 4, fontWeight: 600, color: ACCENT }}
                  addonAfter={
                    <Tooltip title="Copy weight">
                      <Button
                        size="small"
                        type="text"
                        icon={<CopyOutlined />}
                        disabled={convVol == null || convDensity == null}
                        onClick={() =>
                          copyText(
                            `${(convVol * convDensity).toLocaleString(
                              undefined,
                              { maximumFractionDigits: 3 },
                            )} tons`,
                            "Weight",
                          )
                        }
                      />
                    </Tooltip>
                  }
                />
                <Text type="secondary" style={{ fontSize: 11 }}>
                  Typical MSW density starts at 0.20 t/m3.
                </Text>
              </Col>
            </Row>
          </Card>

          <Card size="small" title="m3 to Tons">
            <Row gutter={[12, 12]} align="middle">
              <Col xs={24} sm={10} md={7}>
                <Text type="secondary">Volume</Text>
                <Space.Compact style={{ width: "100%", marginTop: 4 }}>
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    step={0.01}
                    placeholder="0.00"
                    value={convM3ToTons}
                    onChange={setConvM3ToTons}
                  />
                  <span className="ant-input-group-addon">m3</span>
                </Space.Compact>
              </Col>
              <Col xs={24} sm={4} md={2} style={{ textAlign: "center" }}>
                <Text strong>x</Text>
              </Col>
              <Col xs={24} sm={10} md={7}>
                <Text type="secondary">Density used</Text>
                <Input
                  readOnly
                  value={`${convDensity ?? 0.2} t/m3`}
                  style={{ marginTop: 4, color: "#595959" }}
                />
              </Col>
              <Col xs={24} md={8}>
                <Text type="secondary">Weight</Text>
                <Input
                  readOnly
                  value={
                    convM3ToTons != null
                      ? `${(
                          convM3ToTons *
                          (convDensity ?? 0.2)
                        ).toLocaleString(undefined, {
                          maximumFractionDigits: 3,
                        })} tons`
                      : ""
                  }
                  placeholder="Result"
                  style={{ marginTop: 4, fontWeight: 600, color: "#fa8c16" }}
                  addonAfter={
                    <Tooltip title="Copy weight">
                      <Button
                        size="small"
                        type="text"
                        icon={<CopyOutlined />}
                        disabled={convM3ToTons == null}
                        onClick={() =>
                          copyText(
                            `${(
                              convM3ToTons *
                              (convDensity ?? 0.2)
                            ).toLocaleString(undefined, {
                              maximumFractionDigits: 3,
                            })} tons`,
                            "Weight",
                          )
                        }
                      />
                    </Tooltip>
                  }
                />
              </Col>
            </Row>
            <Divider style={{ margin: "12px 0" }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Change the density above when using a site-specific conversion
              factor.
            </Text>
          </Card>
        </Space>
      </Modal>
      <Modal
        title={
          <Space>
            <DatabaseOutlined />
            <span>Set Field Units</span>
          </Space>
        }
        open={unitToolOpen}
        onCancel={() => setUnitToolOpen(false)}
        onOk={applyUnitTool}
        okText="Apply Units"
        width={460}
        zIndex={1700}
        destroyOnHidden={false}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text type="secondary">
            Apply one unit to the SLF capacity, receiving capacity, waste
            received, estimated waste, and all cell capacity/fill unit fields.
          </Text>
          <Select
            value={unitToolValue}
            onChange={setUnitToolValue}
            options={UNIT_OPTIONS}
            style={{ width: "100%" }}
          />
        </Space>
      </Modal>

      {/* Detail Modal */}
      <Modal
        title={
          <Space size={6}>
            <BankOutlined style={{ color: ACCENT }} />
            <span>SLF Facility Details</span>
            {detailModal && (
              <>
                <Text
                  type="secondary"
                  style={{ fontWeight: 400, fontSize: 13 }}
                >
                  —
                </Text>
                <Text strong style={{ color: ACCENT, fontSize: 14 }}>
                  {detailModal.lgu || ""}
                </Text>
                {detailModal.province && (
                  <Text
                    type="secondary"
                    style={{ fontSize: 12, fontWeight: 400 }}
                  >
                    {detailModal.province}
                  </Text>
                )}
              </>
            )}
          </Space>
        }
        open={!!detailModal}
        onCancel={() => setDetailModal(null)}
        footer={<Button onClick={() => setDetailModal(null)}>Close</Button>}
        width={1240}
      >
        {detailModal && (
          <>
            {detailViewRecord ? (
              <Tabs
                defaultActiveKey="slf-dashboard"
                tabPosition="left"
                style={{ minHeight: 400 }}
                tabBarStyle={{
                  background: isDark ? "rgba(22,119,255,0.08)" : "#f0f5ff",
                  borderRight: `1px solid ${isDark ? "#1d3a6b" : "#d6e4ff"}`,
                  borderRadius: "8px 0 0 8px",
                  padding: "8px 0",
                }}
                items={[
                  {
                    key: "slf-dashboard",
                    label: (
                      <span style={{ color: "#722ed1" }}>
                        <BarChartOutlined /> SLF Dashboard
                      </span>
                    ),
                    children: (
                      <SlfDashboardTab dashboard={detailDashboard} isDark={isDark} />
                    ),
                  },
                  {
                    key: "1",
                    label: (
                      <span style={{ color: "#1677ff" }}>
                        <EnvironmentOutlined /> Location &amp; Facility Details
                      </span>
                    ),
                    children: (
                      <>
                        <Descriptions column={2} size="small" bordered>
                          <Descriptions.Item label="Province">
                            {detailViewRecord.province || "—"}
                          </Descriptions.Item>
                          <Descriptions.Item label="LGU">
                            {detailViewRecord.lgu || "—"}
                          </Descriptions.Item>
                          <Descriptions.Item label="Barangay">
                            {detailViewRecord.barangay || "—"}
                          </Descriptions.Item>
                          <Descriptions.Item label="MBA">
                            {detailViewRecord.manilaBayArea || "—"}
                          </Descriptions.Item>
                          <Descriptions.Item label="Ownership">
                            {detailViewRecord.ownership || "—"}
                          </Descriptions.Item>
                          <Descriptions.Item label="District">
                            {detailViewRecord.congressionalDistrict || "—"}
                          </Descriptions.Item>
                          <Descriptions.Item label="Status">
                            {getStatusTag(detailViewRecord.statusOfSLF)}
                          </Descriptions.Item>
                          <Descriptions.Item label="SLF Category">
                            {detailViewRecord.category ? (
                              <Tag color="blue">
                                {detailViewRecord.category}
                              </Tag>
                            ) : (
                              "—"
                            )}
                          </Descriptions.Item>
                          <Descriptions.Item label="Year Started">
                            {detailViewRecord.yearStartedOperation || "—"}
                          </Descriptions.Item>
                          <Descriptions.Item label="Capacity per day">
                            {detailViewRecord.receivingVolumeCapacity
                              ? `${Number(detailViewRecord.receivingVolumeCapacity).toLocaleString()} ${normalizeUnit(detailViewRecord.receivingVolumeCapacityUnit)}`
                              : "—"}
                          </Descriptions.Item>
                          <Descriptions.Item label="LGUs Served">
                            {detailViewRecord.noOfLGUServed || "—"}
                          </Descriptions.Item>
                          <Descriptions.Item label="WWTF">
                            {detailViewRecord.hasWastewaterTreatmentFacility ? (
                              <Tag color="success">Yes</Tag>
                            ) : (
                              <Tag>No</Tag>
                            )}
                          </Descriptions.Item>
                          <Descriptions.Item label="Treatment Type">
                            {formatStringArray(detailViewRecord.wastewaterTreatmentFacilityType) ||
                              "—"}
                          </Descriptions.Item>
                          <Descriptions.Item label="WWTF Remarks">
                            {detailViewRecord.wastewaterTreatmentFacilityRemarks || "—"}
                          </Descriptions.Item>
                        </Descriptions>
                        {(detailViewRecord.receivingFacilities || []).length >
                          0 && (
                          <>
                            <Divider plain orientation="left">
                              <BankOutlined /> Receiving Facility Table
                            </Divider>
                            <Table
                              dataSource={detailViewRecord.receivingFacilities}
                              rowKey={(_, i) => i}
                              size="small"
                              pagination={false}
                              columns={[
                                {
                                  title: "No.",
                                  width: 64,
                                  align: "center",
                                  render: (_, __, index) => index + 1,
                                },
                                {
                                  title: "MRF Type",
                                  dataIndex: "mrfTypes",
                                  render: (types) =>
                                    (types || []).length ? (
                                      <Space wrap>
                                        {(types || []).map((type) => (
                                          <Tag key={type} color="blue">
                                            {type}
                                          </Tag>
                                        ))}
                                      </Space>
                                    ) : (
                                      "—"
                                    ),
                                },
                                {
                                  title: "MRF Name",
                                  dataIndex: "mrfName",
                                  render: (value) => value || "—",
                                },
                                {
                                  title: "Status",
                                  dataIndex: "status",
                                  width: 150,
                                  render: (value) =>
                                    value ? (
                                      <Tag
                                        color={
                                          value === "Active"
                                            ? "green"
                                            : value === "Under Construction"
                                              ? "orange"
                                              : "default"
                                        }
                                      >
                                        {value}
                                      </Tag>
                                    ) : (
                                      "—"
                                    ),
                                },
                                {
                                  title: "Description",
                                  dataIndex: "description",
                                  render: (value) =>
                                    value ? (
                                      <Text
                                        ellipsis={{ tooltip: value }}
                                        style={{
                                          maxWidth: 280,
                                          display: "block",
                                        }}
                                      >
                                        {value}
                                      </Text>
                                    ) : (
                                      <Text type="secondary">—</Text>
                                    ),
                                },
                              ]}
                            />
                          </>
                        )}
                      </>
                    ),
                  },
                  {
                    key: "2",
                    label: (
                      <span style={{ color: "#fa8c16" }}>
                        <BankOutlined /> Facility &amp; Operations
                      </span>
                    ),
                    children: (() => {
                      const cells = detailViewRecord.numberOfCell || 0;
                      const leachate = detailViewRecord.noOfLeachatePond || 0;
                      const gasVents = detailViewRecord.numberOfGasVents || 0;
                      const wasteReceived =
                        detailViewRecord.actualResidualWasteReceived || 0;
                      const wasteReceivedUnit = normalizeUnit(
                        detailViewRecord.wasteReceivedUnit || "m³",
                      );
                      const estVolume = 0;
                      const capacity = detailViewRecord.volumeCapacity || 0;
                      const capacityUnit = normalizeUnit(
                        detailViewRecord.volumeCapacityUnit || "m³",
                      );
                      const wasteReceivedInCapacityUnit = convertVolume(
                        wasteReceived,
                        wasteReceivedUnit,
                        capacityUnit,
                      );
                      const receivingCapacity =
                        detailViewRecord.receivingVolumeCapacity || 0;
                      const receivingCapacityUnit = normalizeUnit(
                        detailViewRecord.receivingVolumeCapacityUnit ||
                          detailViewRecord.volumeCapacityUnit ||
                          "m³",
                      );
                      const infraData = [
                        { name: "Cells", value: cells },
                        { name: "Leachate Treatment Plant", value: leachate },
                        { name: "Gas Management", value: gasVents },
                      ].filter((d) => d.value > 0);
                      const capacityData = (() => {
                        if (capacity > 0) {
                          return [
                            {
                              name: "Waste Received",
                              value: Math.min(wasteReceivedInCapacityUnit, capacity),
                            },
                            {
                              name: "Remaining Capacity",
                              value: Math.max(0, capacity - wasteReceivedInCapacityUnit),
                            },
                          ];
                        }
                        return wasteReceived > 0
                          ? [{ name: "Waste Received", value: wasteReceived }]
                          : [];
                      })();
                      const volumeData = [
                        wasteReceived > 0 && {
                          name: "Waste Received",
                          value: wasteReceived,
                        },
                        capacity > 0 && { name: "Capacity", value: capacity },
                      ].filter(Boolean);
                      const activeCellEntries = Array.isArray(
                        baselineData?.activeCellEntries,
                      )
                        ? baselineData.activeCellEntries
                        : [];
                      const closedCellEntries = Array.isArray(
                        baselineData?.closedCellEntries,
                      )
                        ? baselineData.closedCellEntries
                        : [];
                      const baselineEntryUnit = normalizeUnit(
                        baselineData?.baselineUnit ||
                          baselineData?.totalVolumeAcceptedUnit ||
                          "m³",
                      );
                      const baselineEntryVolumeData = [
                        ...activeCellEntries.map((entry, i) => ({
                          name: `Active ${entry.cellName || `Cell ${i + 1}`}`,
                          value: Number(entry.volume || 0),
                          unit: normalizeUnit(entry.unit || baselineEntryUnit),
                        })),
                        ...closedCellEntries.map((entry, i) => ({
                          name: `Closed ${entry.cellName || `Cell ${i + 1}`}`,
                          value: Number(entry.volume || 0),
                          unit: normalizeUnit(entry.unit || baselineEntryUnit),
                        })),
                      ].filter((item) => item.value > 0);
                      // Cell volume data from baseline
                      const aggregateCellVolumeData = baselineData
                        ? [
                            baselineData.activeCellResidualVolume > 0 && {
                              name: "Active Residual",
                              value: baselineData.activeCellResidualVolume,
                              unit: (
                                baselineData.activeCellResidualUnit || "m³"
                              ).replace("m3", "m³"),
                            },
                            baselineData.activeCellInertVolume > 0 && {
                              name: "Active Inert",
                              value: baselineData.activeCellInertVolume,
                              unit: (
                                baselineData.activeCellInertUnit || "m³"
                              ).replace("m3", "m³"),
                            },
                            baselineData.closedCellResidualVolume > 0 && {
                              name: "Closed Residual",
                              value: baselineData.closedCellResidualVolume,
                              unit: (
                                baselineData.closedCellResidualUnit || "m³"
                              ).replace("m3", "m³"),
                            },
                            baselineData.closedCellInertVolume > 0 && {
                              name: "Closed Inert",
                              value: baselineData.closedCellInertVolume,
                              unit: (
                                baselineData.closedCellInertUnit || "m³"
                              ).replace("m3", "m³"),
                            },
                          ].filter(Boolean)
                        : [];
                      const cellVolumeData =
                        baselineEntryVolumeData.length > 0
                          ? baselineEntryVolumeData
                          : aggregateCellVolumeData;
                      const hasCharts =
                        infraData.length > 0 ||
                        capacityData.length > 0 ||
                        cellVolumeData.length > 0;
                      const pctUsed =
                        capacity > 0
                          ? Math.min(
                              Math.round((wasteReceivedInCapacityUnit / capacity) * 100),
                              100,
                            )
                          : 0;
                      const cellCaps = detailViewRecord.cellCapacities || [];
                      return (
                        <>
                          <Descriptions
                            column={3}
                            size="small"
                            bordered
                            style={{ marginBottom: 16 }}
                          >
                            <Descriptions.Item label="Cells">
                              {cells || "—"}
                            </Descriptions.Item>
                            <Descriptions.Item label="Leachate Treatment Plant">
                              {leachate || "—"}
                            </Descriptions.Item>
                            <Descriptions.Item label="Gas Management">
                              {gasVents || "—"}
                            </Descriptions.Item>
                            <Descriptions.Item
                              label="Waste Received in Cell"
                              span={1}
                            >
                              {wasteReceived
                                ? `${Number(wasteReceived).toLocaleString()} ${normalizeUnit(detailViewRecord.wasteReceivedUnit || "tons")}`
                                : "—"}
                            </Descriptions.Item>
                            <Descriptions.Item
                              label="Capacity per day"
                              span={1}
                            >
                              {receivingCapacity
                                ? `${Number(receivingCapacity).toLocaleString()} ${receivingCapacityUnit}`
                                : "—"}
                            </Descriptions.Item>
                          </Descriptions>

                          {/* Cell Infrastructure Status */}
                          {cells > 0 &&
                            (() => {
                              const cellStatuses =
                                detailViewRecord.cellStatuses || [];
                              const cellTypesArr =
                                detailViewRecord.cellTypes || [];
                              const cellCapacityUnits =
                                detailViewRecord.cellCapacityUnits || [];
                              const hasAnyBaselineData = Boolean(baselineData);
                              const hasCellUsageRows =
                                (detailViewRecord._cellUsageRows || []).some(
                                  (row) =>
                                    Number(row?.baseline || 0) > 0 ||
                                    Number(row?.submissions || 0) > 0 ||
                                    Number(row?.total || 0) > 0,
                                );
                              const hasCellBaseline =
                                hasCellUsageRows ||
                                (baselineData &&
                                  (activeCellEntries.some(
                                  (entry) => Number(entry?.volume || 0) > 0,
                                ) ||
                                  closedCellEntries.some(
                                    (entry) => Number(entry?.volume || 0) > 0,
                                  ) ||
                                  baselineData.activeCellResidualVolume > 0 ||
                                  baselineData.activeCellInertVolume > 0 ||
                                  baselineData.closedCellResidualVolume > 0 ||
                                    baselineData.closedCellInertVolume > 0));
                              return (
                                <>
                                  <Divider plain orientation="left">
                                    <BarChartOutlined /> Cell Infrastructure
                                    Status
                                  </Divider>
                                  <Row
                                    gutter={[16, 16]}
                                    style={{ marginBottom: 16 }}
                                  >
                                    <Col xs={24} md={10}>
                                      <Card
                                        size="small"
                                        title={
                                          <>
                                            <PieChartOutlined
                                              style={{ color: "#2f54eb" }}
                                            />{" "}
                                            Capacity Utilization
                                          </>
                                        }
                                        style={{ borderRadius: 10 }}
                                      >
                                        {capacityData.length > 0 ? (
                                          <ResponsiveContainer
                                            width="100%"
                                            height={190}
                                          >
                                            <PieChart>
                                              <Pie
                                                data={capacityData}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={48}
                                                outerRadius={75}
                                                paddingAngle={
                                                  capacityData.length > 1
                                                    ? 3
                                                    : 0
                                                }
                                                dataKey="value"
                                                isAnimationActive={false}
                                                animationBegin={80}
                                                animationDuration={650}
                                              >
                                                {capacityData.map(
                                                  (entry, i) => (
                                                    <RCell
                                                      key={i}
                                                      fill={
                                                        entry.name.includes(
                                                          "Waste",
                                                        )
                                                          ? "#52c41a"
                                                          : entry.name.includes(
                                                                "Remaining",
                                                              )
                                                            ? "#d9d9d9"
                                                            : CHART_COLORS[
                                                                i %
                                                                  CHART_COLORS.length
                                                              ]
                                                      }
                                                    />
                                                  ),
                                                )}
                                              </Pie>
                                              <RTooltip
                                                formatter={(v) =>
                                                  v.toLocaleString()
                                                }
                                              />
                                              <Legend
                                                wrapperStyle={{ fontSize: 11 }}
                                              />
                                            </PieChart>
                                          </ResponsiveContainer>
                                        ) : (
                                          <div
                                            style={{
                                              textAlign: "center",
                                              padding: "30px 0",
                                              color: "#8c8c8c",
                                              fontSize: 12,
                                            }}
                                          >
                                            No capacity data available
                                          </div>
                                        )}
                                        <Row
                                          gutter={8}
                                          style={{
                                            marginTop: 8,
                                            borderTop: "1px solid #f0f0f0",
                                            paddingTop: 8,
                                          }}
                                        >
                                          <Col span={12}>
                                            <div
                                              style={{
                                                fontSize: 11,
                                                color: "#8c8c8c",
                                              }}
                                            >
                                              Waste Received
                                            </div>
                                            <div
                                              style={{
                                                fontSize: 14,
                                                fontWeight: 600,
                                              }}
                                            >
                                              {wasteReceived > 0
                                                ? `${wasteReceived.toLocaleString()} ${normalizeUnit(detailViewRecord.wasteReceivedUnit || "tons")}`
                                                : "0"}
                                            </div>
                                            {detailViewRecord._submissionWasteReceived >
                                              0 && (
                                              <div
                                                style={{
                                                  fontSize: 10,
                                                  color: "#2f54eb",
                                                }}
                                              >
                                                {Number(
                                                  detailViewRecord._baselineWasteReceived ||
                                                    0,
                                                ).toLocaleString()}{" "}
                                                baseline +{" "}
                                                {Number(
                                                  detailViewRecord._submissionWasteReceived,
                                                ).toLocaleString()}{" "}
                                                submissions
                                              </div>
                                            )}
                                          </Col>
                                          <Col span={12}>
                                            <div
                                              style={{
                                                fontSize: 11,
                                                color: "#8c8c8c",
                                              }}
                                            >
                                              Total Capacity
                                            </div>
                                            <div
                                              style={{
                                                fontSize: 14,
                                                fontWeight: 600,
                                              }}
                                            >
                                              {capacity > 0
                                                ? `${capacity.toLocaleString()} ${normalizeUnit(detailViewRecord.volumeCapacityUnit)}`
                                                : "—"}
                                            </div>
                                          </Col>
                                          <Col
                                            span={12}
                                            style={{ marginTop: 8 }}
                                          >
                                            <div
                                              style={{
                                                fontSize: 11,
                                                color: "#8c8c8c",
                                              }}
                                            >
                                              Remaining
                                            </div>
                                            <div
                                              style={{
                                                fontSize: 14,
                                                fontWeight: 600,
                                                color:
                                                  capacity - wasteReceivedInCapacityUnit <= 0
                                                    ? "#ff4d4f"
                                                    : "#52c41a",
                                              }}
                                            >
                                              {capacity > 0
                                                    ? `${Math.max(0, capacity - wasteReceivedInCapacityUnit).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${capacityUnit}`
                                                : "—"}
                                            </div>
                                          </Col>
                                          <Col
                                            span={12}
                                            style={{ marginTop: 8 }}
                                          >
                                            <div
                                              style={{
                                                fontSize: 11,
                                                color: "#8c8c8c",
                                              }}
                                            >
                                              Status
                                            </div>
                                            <Tag
                                              color={
                                                detailViewRecord.statusOfSLF
                                                  ?.toLowerCase()
                                                  .includes("non")
                                                  ? "red"
                                                  : "green"
                                              }
                                              style={{ margin: 0 }}
                                            >
                                              {detailViewRecord.statusOfSLF ||
                                                "—"}
                                            </Tag>
                                          </Col>
                                        </Row>
                                      </Card>
                                    </Col>
                                    <Col xs={24} md={14}>
                                      <Card
                                        size="small"
                                        title={
                                          <Space wrap size={4}>
                                            <BarChartOutlined /> Per-Cell Status
                                            &amp; Capacity
                                            {detailViewRecord._cellUsageSubmissionCount >
                                              0 && (
                                              <Tag
                                                color="geekblue"
                                                style={{ fontSize: 10 }}
                                              >
                                                {
                                                  detailViewRecord._cellUsageSubmissionCount
                                                }{" "}
                                                portal submission
                                                {detailViewRecord._cellUsageSubmissionCount !==
                                                1
                                                  ? "s"
                                                  : ""}{" "}
                                                included
                                              </Tag>
                                            )}
                                          </Space>
                                        }
                                        style={{ borderRadius: 10 }}
                                      >
                                        {(() => {
                                          const fillValues =
                                            detailViewRecord.cellFillValues || [];
                                          const fillUnits =
                                            detailViewRecord.cellFillUnits || [];
                                          const alertCells = (cellCaps.length > 0
                                            ? cellCaps
                                            : Array.from({ length: cells }, () => 0)
                                          )
                                            .map((cap, index) => {
                                              const status = normalizeCellStatus(
                                                cellStatuses[index],
                                              );
                                              if (!isActiveCellStatus(status) || Number(cap || 0) <= 0) return null;
                                              const capUnit = normalizeUnit(
                                                cellCapacityUnits[index] ||
                                                  detailViewRecord.volumeCapacityUnit ||
                                                  "m³",
                                              );
                                              const used = convertVolume(
                                                fillValues[index] || 0,
                                                fillUnits[index] || detailViewRecord.wasteReceivedUnit || capUnit,
                                                capUnit,
                                              );
                                              const pct = Math.min(
                                                Math.round((used / Number(cap || 0)) * 100),
                                                100,
                                              );
                                              return {
                                                index,
                                                pct,
                                                used,
                                                capacity: Number(cap || 0),
                                                unit: capUnit,
                                                status,
                                              };
                                            })
                                            .filter((cell) => cell && cell.pct >= 80);
                                          return alertCells.length > 0 ? (
                                            <Alert
                                              type="warning"
                                              showIcon
                                              style={{ marginBottom: 12, borderRadius: 8 }}
                                              message={
                                                <Space wrap>
                                                  <Text strong>
                                                    Active cell reached 80% capacity
                                                  </Text>
                                                  <Tag color="orange">
                                                    Cell {alertCells[0].index + 1}: {alertCells[0].pct}% full
                                                  </Tag>
                                                  <Button
                                                    size="small"
                                                    type="primary"
                                                    icon={<BellOutlined />}
                                                    onClick={() =>
                                                      setCapacityAlertModal({
                                                        open: true,
                                                        record: detailViewRecord,
                                                        cell: alertCells[0],
                                                        message: `${detailViewRecord.lgu || "Assigned SLF"} Cell ${alertCells[0].index + 1} is ${alertCells[0].pct}% full (${alertCells[0].used.toLocaleString(undefined, { maximumFractionDigits: 2 })} / ${alertCells[0].capacity.toLocaleString()} ${alertCells[0].unit}). Please review disposal planning and remaining cell capacity.`,
                                                      })
                                                    }
                                                  >
                                                    Notify Assigned Users
                                                  </Button>
                                                </Space>
                                              }
                                            />
                                          ) : null;
                                        })()}
                                        {detailViewRecord._submissionWasteReceived >
                                          0 && (
                                          <div
                                            style={{
                                              marginBottom: 8,
                                              fontSize: 11,
                                              color: "#8c8c8c",
                                              borderBottom: "1px solid #f0f0f0",
                                              paddingBottom: 6,
                                            }}
                                          >
                                            <Space size={12} wrap>
                                              <span>
                                                Baseline:{" "}
                                                <Text strong>
                                                  {Number(
                                                    detailViewRecord._baselineWasteReceived ||
                                                      0,
                                                  ).toLocaleString()}{" "}
                                                  {normalizeUnit(
                                                    detailViewRecord.wasteReceivedUnit ||
                                                      "tons",
                                                  )}
                                                </Text>
                                              </span>
                                              <span
                                                style={{ color: "#2f54eb" }}
                                              >
                                                Submissions:{" "}
                                                <Text
                                                  strong
                                                  style={{ color: "#2f54eb" }}
                                                >
                                                  +
                                                  {Number(
                                                    detailViewRecord._submissionWasteReceived,
                                                  ).toLocaleString()}{" "}
                                                  {normalizeUnit(
                                                    detailViewRecord._submissionWasteReceivedUnit ||
                                                      "tons",
                                                  )}
                                                </Text>
                                              </span>
                                            </Space>
                                          </div>
                                        )}
                                        <Row gutter={[16, 16]} justify="center">
                                          {(cellCaps.length > 0
                                            ? cellCaps
                                            : Array.from(
                                                { length: cells },
                                                () => 0,
                                              )
                                          ).map((cap, i) => {
                                            const fillValues =
                                              detailViewRecord.cellFillValues ||
                                              [];
                                            const capUnit = normalizeUnit(
                                              cellCapacityUnits[i] ||
                                                detailViewRecord.volumeCapacityUnit ||
                                                "m³",
                                            );
                                            const usedInCell = Number(
                                              fillValues[i] || 0,
                                            );
                                            const cellFillUnit = normalizeUnit(
                                              detailViewRecord.cellFillUnits?.[i] ||
                                                detailViewRecord.wasteReceivedUnit ||
                                                capUnit,
                                            );
                                            const usedForCapacity = convertVolume(
                                              usedInCell,
                                              cellFillUnit,
                                              capUnit,
                                            );
                                            const cellFill =
                                              cap > 0
                                                ? Math.min(
                                                    Math.round(
                                                      (usedForCapacity / cap) * 100,
                                                    ),
                                                    100,
                                                  )
                                                : 0;
                                            const cellSt = normalizeCellStatus(
                                              cellStatuses[i],
                                            );
                                            const cellTy =
                                              cellTypesArr[i] || "Residual";
                                            const isClosed =
                                              isCompletedCellStatus(cellSt);
                                            const isHaz =
                                              cellTy === "Treated Haz Waste";
                                            return (
                                              <Col
                                                xs={12}
                                                sm={8}
                                                key={i}
                                                style={{ textAlign: "center" }}
                                              >
                                                <Progress
                                                  type="dashboard"
                                                  percent={
                                                    isClosed ? 100 : cellFill
                                                  }
                                                  size={80}
                                                  strokeColor={
                                                    isClosed
                                                      ? "#d9d9d9"
                                                      : isHaz
                                                        ? "#f5222d"
                                                        : cellFill >= 90
                                                          ? "#ff4d4f"
                                                          : cellFill >= 70
                                                            ? "#faad14"
                                                            : "#52c41a"
                                                  }
                                                  format={() => (
                                                    <div
                                                      style={{
                                                        lineHeight: 1.2,
                                                      }}
                                                    >
                                                      <div
                                                        style={{
                                                          fontSize: 14,
                                                          fontWeight: 700,
                                                          color: isClosed
                                                            ? "#8c8c8c"
                                                            : isHaz
                                                              ? "#f5222d"
                                                              : cellFill >= 90
                                                                ? "#ff4d4f"
                                                                : cellFill >= 70
                                                                  ? "#faad14"
                                                                  : "#52c41a",
                                                        }}
                                                      >
                                                        {isClosed
                                                          ? "—"
                                                          : `${cellFill}%`}
                                                      </div>
                                                    </div>
                                                  )}
                                                />
                                                <div
                                                  style={{
                                                    marginTop: 6,
                                                    fontSize: 12,
                                                    fontWeight: 600,
                                                  }}
                                                >
                                                  Cell {i + 1}
                                                </div>
                                                <Tag
                                                  color={isHaz ? "red" : "blue"}
                                                  style={{
                                                    fontSize: 9,
                                                    marginTop: 2,
                                                  }}
                                                >
                                                  {cellTy ===
                                                  "Treated Haz Waste"
                                                    ? "Haz Waste"
                                                    : cellTy}
                                                </Tag>
                                                <div
                                                  style={{
                                                    fontSize: 10,
                                                    color: "#8c8c8c",
                                                  }}
                                                >
                                                  {usedInCell > 0
                                                    ? `${usedInCell.toLocaleString()} ${cellFillUnit} / `
                                                    : ""}
                                                  {cap > 0
                                                    ? `${cap.toLocaleString()} ${capUnit}`
                                                    : "—"}
                                                </div>
                                                <div style={{ marginTop: 6 }}>
                                                  <Tag
                                                    color={
                                                      isActiveCellStatus(cellSt)
                                                        ? "success"
                                                        : isClosed
                                                          ? "default"
                                                          : "warning"
                                                    }
                                                    style={{ fontSize: 9 }}
                                                  >
                                                    {cellSt}
                                                  </Tag>
                                                </div>
                                              </Col>
                                            );
                                          })}
                                        </Row>
                                      </Card>
                                    </Col>
                                  </Row>

                                  {/* Baseline cell volumes */}
                                  {hasCellBaseline ? (
                                    (() => {
                                      // Build per-cell rows: prefer _cellUsageRows from enriched record, else build from baseline entries
                                      const cellRows = detailViewRecord
                                        ?._cellUsageRows?.length
                                        ? detailViewRecord._cellUsageRows
                                        : (() => {
                                            const rows = [];
                                            activeCellEntries.forEach(
                                              (entry, i) => {
                                                rows.push({
                                                  key: `active-${i}`,
                                                  cellName:
                                                    entry.cellName ||
                                                    `Cell ${i + 1}`,
                                                  status: "Active Cell",
                                                  type:
                                                    entry.wasteType ||
                                                    "Residual",
                                                  isHazardous:
                                                    isHazardousCellType(
                                                      entry.wasteType,
                                                    ),
                                                  baseline: Number(
                                                    entry.volume || 0,
                                                  ),
                                                  submissions: 0,
                                                  total: Number(
                                                    entry.volume || 0,
                                                  ),
                                                  unit:
                                                    entry.unit ||
                                                    baselineEntryUnit,
                                                  capacity: 0,
                                                  capacityUnit:
                                                    entry.unit ||
                                                    baselineEntryUnit,
                                                });
                                              },
                                            );
                                            closedCellEntries.forEach(
                                              (entry, i) => {
                                                rows.push({
                                                  key: `closed-${i}`,
                                                  cellName:
                                                    entry.cellName ||
                                                    `Closed Cell ${i + 1}`,
                                                  status: "Used/Completed",
                                                  type:
                                                    entry.wasteType ||
                                                    "Residual",
                                                  isHazardous:
                                                    isHazardousCellType(
                                                      entry.wasteType,
                                                    ),
                                                  baseline: Number(
                                                    entry.volume || 0,
                                                  ),
                                                  submissions: 0,
                                                  total: Number(
                                                    entry.volume || 0,
                                                  ),
                                                  unit:
                                                    entry.unit ||
                                                    baselineEntryUnit,
                                                  capacity: 0,
                                                  capacityUnit:
                                                    entry.unit ||
                                                    baselineEntryUnit,
                                                });
                                              },
                                            );
                                            return rows;
                                          })();

                                      const cellTableCols = [
                                        {
                                          title: "Cell",
                                          dataIndex: "cellName",
                                          width: 130,
                                          sorter: (a, b) =>
                                            (a.cellName || "").localeCompare(
                                              b.cellName || "",
                                            ),
                                          render: (v, row) => (
                                            <Space size={4}>
                                              <Text strong>{v}</Text>
                                              {row.isHazardous && (
                                                <Tag
                                                  color="red"
                                                  style={{ fontSize: 9 }}
                                                >
                                                  Haz
                                                </Tag>
                                              )}
                                            </Space>
                                          ),
                                        },
                                        {
                                          title: "Status",
                                          dataIndex: "status",
                                          width: 130,
                                          render: (v, row) => {
                                            const status = normalizeCellStatus(
                                              v || row.cellStatus,
                                            );
                                            return (
                                            <Tag
                                              color={
                                                isActiveCellStatus(status)
                                                  ? "green"
                                                  : isCompletedCellStatus(status)
                                                    ? "default"
                                                    : "gold"
                                              }
                                            >
                                              {status || "Active Cell"}
                                            </Tag>
                                            );
                                          },
                                        },
                                        {
                                          title: "Type",
                                          dataIndex: "type",
                                          width: 120,
                                          render: (v, row) => {
                                            const type =
                                              v || row.wasteType || "Residual";
                                            return (
                                              <Tag
                                                color={
                                                  isHazardousCellType(type)
                                                    ? "red"
                                                    : "blue"
                                                }
                                              >
                                                {isHazardousCellType(type)
                                                  ? "Treated Haz Waste"
                                                  : "Residual"}
                                              </Tag>
                                            );
                                          },
                                        },
                                        {
                                          title: "Baseline Volume",
                                          key: "baseline",
                                          align: "right",
                                          render: (_, row) =>
                                            row.baseline > 0 ? (
                                              <Text
                                                style={{ color: "#595959" }}
                                              >
                                                {Number(
                                                  row.baseline,
                                                ).toLocaleString(undefined, {
                                                  maximumFractionDigits: 2,
                                                })}{" "}
                                                {row.unit}
                                              </Text>
                                            ) : (
                                              "—"
                                            ),
                                        },
                                        {
                                          title: "Submissions",
                                          key: "submissions",
                                          align: "right",
                                          render: (_, row) =>
                                            row.submissions > 0 ? (
                                              <Text
                                                strong
                                                style={{ color: "#2f54eb" }}
                                              >
                                                +
                                                {Number(
                                                  row.submissions,
                                                ).toLocaleString(undefined, {
                                                  maximumFractionDigits: 2,
                                                })}{" "}
                                                {row.unit}
                                              </Text>
                                            ) : (
                                              <Text type="secondary">—</Text>
                                            ),
                                        },
                                        {
                                          title: "Total Fill",
                                          key: "total",
                                          align: "right",
                                          render: (_, row) => {
                                            const pctFill =
                                              row.capacity > 0
                                                ? Math.min(
                                                    Math.round(
                                                      (row.total /
                                                        row.capacity) *
                                                        100,
                                                    ),
                                                    100,
                                                  )
                                                : null;
                                            return row.total > 0 ? (
                                              <Space
                                                direction="vertical"
                                                size={0}
                                                align="end"
                                              >
                                                <Text strong>
                                                  {Number(
                                                    row.total,
                                                  ).toLocaleString(undefined, {
                                                    maximumFractionDigits: 2,
                                                  })}{" "}
                                                  {row.unit}
                                                </Text>
                                                {pctFill != null && (
                                                  <Text
                                                    style={{
                                                      fontSize: 10,
                                                      color:
                                                        pctFill >= 90
                                                          ? "#ff4d4f"
                                                          : pctFill >= 70
                                                            ? "#faad14"
                                                            : "#52c41a",
                                                    }}
                                                  >
                                                    {pctFill}% full
                                                  </Text>
                                                )}
                                              </Space>
                                            ) : (
                                              "—"
                                            );
                                          },
                                        },
                                        {
                                          title: "Capacity",
                                          key: "capacity",
                                          align: "right",
                                          render: (_, row) =>
                                            row.capacity > 0
                                              ? `${Number(row.capacity).toLocaleString()} ${row.capacityUnit || row.unit}`
                                              : "—",
                                        },
                                      ];

                                      cellTableCols.push({
                                        title: "Daily Submissions",
                                        key: "dailySubmissions",
                                        width: 150,
                                        align: "center",
                                        render: (_, row) => (
                                          <Button
                                            size="small"
                                            icon={<EyeOutlined />}
                                            disabled={Number(row.submissions || 0) <= 0}
                                            onClick={() => openDailySubmissionsModal(row)}
                                          >
                                            View
                                          </Button>
                                        ),
                                      });

                                      const totalBaseline = cellRows.reduce(
                                        (s, r) => s + (r.baseline || 0),
                                        0,
                                      );
                                      const totalSub = cellRows.reduce(
                                        (s, r) => s + (r.submissions || 0),
                                        0,
                                      );
                                      const totalFill = cellRows.reduce(
                                        (s, r) => s + (r.total || 0),
                                        0,
                                      );
                                      const displayUnit =
                                        cellRows[0]?.unit || baselineEntryUnit;

                                      return (
                                        <Collapse
                                          size="small"
                                          bordered={false}
                                          destroyOnHidden
                                          style={{ marginBottom: 8 }}
                                          items={[
                                            {
                                              key: "cell-volumes",
                                              label: (
                                                <Space wrap>
                                                  <DatabaseOutlined
                                                    style={{ color: "#2f54eb" }}
                                                  />
                                                  <Text strong>
                                                    Submission Cell Placement
                                                  </Text>
                                                  <Tag color="blue">
                                                    {cellRows.length} cell
                                                    {cellRows.length !== 1
                                                      ? "s"
                                                      : ""}
                                                  </Tag>
                                                  {totalBaseline > 0 && (
                                                    <Tag color="default">
                                                      Baseline{" "}
                                                      {Number(
                                                        totalBaseline,
                                                      ).toLocaleString(
                                                        undefined,
                                                        {
                                                          maximumFractionDigits: 1,
                                                        },
                                                      )}{" "}
                                                      {displayUnit}
                                                    </Tag>
                                                  )}
                                                  {totalSub > 0 && (
                                                    <Tag color="geekblue">
                                                      +
                                                      {Number(
                                                        totalSub,
                                                      ).toLocaleString(
                                                        undefined,
                                                        {
                                                          maximumFractionDigits: 1,
                                                        },
                                                      )}{" "}
                                                      {displayUnit} from
                                                      submissions
                                                    </Tag>
                                                  )}
                                                </Space>
                                              ),
                                              children: (
                                                <Table
                                                  dataSource={cellRows}
                                                  columns={cellTableCols}
                                                  rowKey={(row) =>
                                                    row.key ||
                                                    `${row.cellName}-${row.index}`
                                                  }
                                                  size="small"
                                                  pagination={false}
                                                  scroll={{ x: 760 }}
                                                  summary={() => (
                                                    <Table.Summary.Row>
                                                      <Table.Summary.Cell
                                                        index={0}
                                                        colSpan={3}
                                                      >
                                                        <Text strong>
                                                          Total
                                                        </Text>
                                                      </Table.Summary.Cell>
                                                      <Table.Summary.Cell
                                                        index={3}
                                                        align="right"
                                                      >
                                                        <Text
                                                          strong
                                                          style={{
                                                            color: "#595959",
                                                          }}
                                                        >
                                                          {totalBaseline > 0
                                                            ? `${Number(totalBaseline).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${displayUnit}`
                                                            : "—"}
                                                        </Text>
                                                      </Table.Summary.Cell>
                                                      <Table.Summary.Cell
                                                        index={4}
                                                        align="right"
                                                      >
                                                        <Text
                                                          strong
                                                          style={{
                                                            color: "#2f54eb",
                                                          }}
                                                        >
                                                          {totalSub > 0
                                                            ? `+${Number(totalSub).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${displayUnit}`
                                                            : "—"}
                                                        </Text>
                                                      </Table.Summary.Cell>
                                                      <Table.Summary.Cell
                                                        index={5}
                                                        align="right"
                                                      >
                                                        <Text strong>
                                                          {totalFill > 0
                                                            ? `${Number(totalFill).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${displayUnit}`
                                                            : "—"}
                                                        </Text>
                                                      </Table.Summary.Cell>
                                                      <Table.Summary.Cell
                                                        index={6}
                                                      />
                                                      <Table.Summary.Cell
                                                        index={7}
                                                      />
                                                    </Table.Summary.Row>
                                                  )}
                                                />
                                              ),
                                            },
                                          ]}
                                        />
                                      );
                                    })()
                                  ) : hasAnyBaselineData ? (
                                    <Empty
                                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                                      description="No baseline cell volumes encoded yet"
                                      style={{ marginBottom: 8 }}
                                    />
                                  ) : (
                                    <Alert
                                      type="warning"
                                      showIcon
                                      message="Baseline cell information not available"
                                      description="The assigned SLF's baseline cell information (Active/Closed cell volumes) needs to be updated in the Baseline Data tab."
                                      style={{
                                        marginBottom: 8,
                                        borderRadius: 8,
                                      }}
                                    />
                                  )}
                                </>
                              );
                            })()}

                          {/* Leachate Treatment Plant */}
                          {false && ((detailViewRecord.leachatePondDetails || [])
                            .length > 0 ||
                            leachate > 0) && (
                            <>
                              <Divider plain orientation="left">
                                <AlertOutlined style={{ color: "#1677ff" }} />{" "}
                                Leachate Treatment Plant
                              </Divider>
                              {(detailViewRecord.leachatePondDetails || [])
                                .length > 0 ? (
                                <Table
                                  dataSource={
                                    detailViewRecord.leachatePondDetails
                                  }
                                  rowKey={(_, i) => i}
                                  size="small"
                                  pagination={false}
                                  style={{ marginBottom: 16 }}
                                  columns={[
                                    {
                                      title: "Pond No.",
                                      dataIndex: "pondNo",
                                      width: 80,
                                      render: (v) => v ?? "—",
                                    },
                                    {
                                      title: "Description",
                                      dataIndex: "description",
                                      render: (v) =>
                                        v ? (
                                          <Text
                                            ellipsis={{ tooltip: v }}
                                            style={{
                                              maxWidth: 280,
                                              display: "block",
                                            }}
                                          >
                                            {v}
                                          </Text>
                                        ) : (
                                          <Text type="secondary">—</Text>
                                        ),
                                    },
                                    {
                                      title: "Status",
                                      dataIndex: "status",
                                      width: 150,
                                      render: (v) => (
                                        <Tag
                                          color={
                                            v === "Active"
                                              ? "blue"
                                              : v === "Under Maintenance"
                                                ? "orange"
                                                : "default"
                                          }
                                        >
                                          {v || "—"}
                                        </Tag>
                                      ),
                                    },
                                  ]}
                                />
                              ) : (
                                <Alert
                                  type="info"
                                  showIcon
                                  message={`${leachate} leachate pond(s) recorded (no detail entries yet)`}
                                  style={{ marginBottom: 16, borderRadius: 8 }}
                                />
                              )}
                            </>
                          )}

                          {/* Gas Management Details */}
                          {false && ((detailViewRecord.gasVentDetails || []).length >
                            0 ||
                            gasVents > 0) && (
                            <>
                              <Divider plain orientation="left">
                                <ExperimentOutlined
                                  style={{ color: "#52c41a" }}
                                />{" "}
                                Gas Management Details
                              </Divider>
                              {(detailViewRecord.gasVentDetails || []).length >
                              0 ? (
                                <Table
                                  dataSource={detailViewRecord.gasVentDetails}
                                  rowKey={(_, i) => i}
                                  size="small"
                                  pagination={false}
                                  style={{ marginBottom: 16 }}
                                  columns={[
                                    {
                                      title: "Vent No.",
                                      dataIndex: "ventNo",
                                      width: 80,
                                      render: (v) => v ?? "—",
                                    },
                                    {
                                      title: "Type",
                                      dataIndex: "ventType",
                                      width: 130,
                                      render: (v) => v || "—",
                                    },
                                    {
                                      title: "Description",
                                      dataIndex: "description",
                                      render: (v) =>
                                        v ? (
                                          <Text
                                            ellipsis={{ tooltip: v }}
                                            style={{
                                              maxWidth: 220,
                                              display: "block",
                                            }}
                                          >
                                            {v}
                                          </Text>
                                        ) : (
                                          <Text type="secondary">—</Text>
                                        ),
                                    },
                                    {
                                      title: "Status",
                                      dataIndex: "status",
                                      width: 150,
                                      render: (v) => (
                                        <Tag
                                          color={
                                            v === "Active"
                                              ? "green"
                                              : v === "Under Maintenance"
                                                ? "orange"
                                                : "default"
                                          }
                                        >
                                          {v || "—"}
                                        </Tag>
                                      ),
                                    },
                                  ]}
                                />
                              ) : (
                                <Alert
                                  type="info"
                                  showIcon
                                  message={`${gasVents} gas management record(s) recorded (no detail entries yet)`}
                                  style={{ marginBottom: 16, borderRadius: 8 }}
                                />
                              )}
                            </>
                          )}

                          {hasCharts && (
                            <>
                              <Divider plain orientation="left">
                                <BarChartOutlined /> Charts
                              </Divider>
                              <Row gutter={[16, 16]}>
                                {/* Capacity Utilization Pie — shown in Charts section only when no cell infra section (cells === 0) */}
                                {capacityData.length > 0 && cells === 0 && (
                                  <Col xs={24} md={12}>
                                    <Card
                                      size="small"
                                      title="Capacity Utilization by Waste Type"
                                      style={{ borderRadius: 10 }}
                                    >
                                      <ResponsiveContainer
                                        width="100%"
                                        height={220}
                                      >
                                        <PieChart>
                                          <Pie
                                            data={capacityData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={50}
                                            outerRadius={80}
                                            paddingAngle={
                                              capacityData.length > 1 ? 3 : 0
                                            }
                                            dataKey="value"
                                            isAnimationActive={false}
                                            animationBegin={80}
                                            animationDuration={650}
                                            label={({ name, value }) =>
                                              `${name}: ${value.toLocaleString()}`
                                            }
                                          >
                                            {capacityData.map((entry, i) => (
                                              <RCell
                                                key={i}
                                                fill={
                                                  entry.name.includes(
                                                    "Residual",
                                                  )
                                                    ? "#52c41a"
                                                    : entry.name.includes("Haz")
                                                      ? "#ff4d4f"
                                                      : entry.name.includes(
                                                            "Remaining",
                                                          )
                                                        ? "#d9d9d9"
                                                        : CHART_COLORS[
                                                            i %
                                                              CHART_COLORS.length
                                                          ]
                                                }
                                              />
                                            ))}
                                          </Pie>
                                          <RTooltip
                                            formatter={(v) =>
                                              v.toLocaleString()
                                            }
                                          />
                                          <Legend />
                                        </PieChart>
                                      </ResponsiveContainer>
                                    </Card>
                                  </Col>
                                )}
                                {/* Volume Comparison Bar */}
                                {volumeData.length > 1 && (
                                  <Col xs={24} md={12}>
                                    <Card
                                      size="small"
                                      title="Volume Comparison"
                                      style={{ borderRadius: 10 }}
                                    >
                                      <ResponsiveContainer
                                        width="100%"
                                        height={220}
                                      >
                                        <BarChart data={volumeData}>
                                          <CartesianGrid strokeDasharray="3 3" />
                                          <XAxis
                                            dataKey="name"
                                            tick={{ fontSize: 12 }}
                                          />
                                          <YAxis />
                                          <RTooltip
                                            formatter={(v) =>
                                              v.toLocaleString()
                                            }
                                          />
                                          <Bar
                                            dataKey="value"
                                            fill="#52c41a"
                                            radius={[4, 4, 0, 0]}
                                          >
                                            {volumeData.map((_, i) => (
                                              <RCell
                                                key={i}
                                                fill={
                                                  CHART_COLORS[
                                                    i % CHART_COLORS.length
                                                  ]
                                                }
                                              />
                                            ))}
                                          </Bar>
                                        </BarChart>
                                      </ResponsiveContainer>
                                    </Card>
                                  </Col>
                                )}
                                {/* Cell Volumes (from baseline) */}
                                {cellVolumeData.length > 0 && (
                                  <Col
                                    xs={24}
                                    md={cellVolumeData.length >= 2 ? 12 : 24}
                                  >
                                    <Card
                                      size="small"
                                      title="Cell Volumes (Baseline)"
                                      style={{ borderRadius: 10 }}
                                    >
                                      <ResponsiveContainer
                                        width="100%"
                                        height={220}
                                      >
                                        <BarChart data={cellVolumeData}>
                                          <CartesianGrid strokeDasharray="3 3" />
                                          <XAxis
                                            dataKey="name"
                                            tick={{ fontSize: 11 }}
                                          />
                                          <YAxis />
                                          <RTooltip
                                            formatter={(v, _, entry) =>
                                              `${v.toLocaleString()} ${entry.payload.unit || ""}`
                                            }
                                          />
                                          <Bar
                                            dataKey="value"
                                            fill="#722ed1"
                                            radius={[4, 4, 0, 0]}
                                          >
                                            {cellVolumeData.map((_, i) => (
                                              <RCell
                                                key={i}
                                                fill={
                                                  CHART_COLORS[
                                                    (i + 3) %
                                                      CHART_COLORS.length
                                                  ]
                                                }
                                              />
                                            ))}
                                          </Bar>
                                        </BarChart>
                                      </ResponsiveContainer>
                                    </Card>
                                  </Col>
                                )}
                                {/* Per-cell pie if 2+ cells */}
                                {cells >= 2 && cellVolumeData.length >= 2 && (
                                  <Col xs={24} md={12}>
                                    <Card
                                      size="small"
                                      title="Cell Volume Distribution"
                                      style={{ borderRadius: 10 }}
                                    >
                                      <ResponsiveContainer
                                        width="100%"
                                        height={220}
                                      >
                                        <PieChart>
                                          <Pie
                                            data={cellVolumeData}
                                            cx="50%"
                                            cy="50%"
                                            outerRadius={80}
                                            paddingAngle={3}
                                            dataKey="value"
                                            isAnimationActive={false}
                                            animationBegin={80}
                                            animationDuration={650}
                                            label={({ name, value }) =>
                                              `${name}: ${value.toLocaleString()}`
                                            }
                                          >
                                            {cellVolumeData.map((_, i) => (
                                              <RCell
                                                key={i}
                                                fill={
                                                  CHART_COLORS[
                                                    (i + 3) %
                                                      CHART_COLORS.length
                                                  ]
                                                }
                                              />
                                            ))}
                                          </Pie>
                                          <RTooltip
                                            formatter={(v, _, entry) =>
                                              `${v.toLocaleString()} ${entry.payload.unit || ""}`
                                            }
                                          />
                                          <Legend />
                                        </PieChart>
                                      </ResponsiveContainer>
                                    </Card>
                                  </Col>
                                )}
                              </Row>
                            </>
                          )}
                        </>
                      );
                    })(),
                  },
                  {
                    key: "leachate-details",
                    label: (
                      <span style={{ color: "#1677ff" }}>
                        <AlertOutlined /> Leachate Treatment Plant
                      </span>
                    ),
                    children:
                      (detailViewRecord.leachatePondDetails || []).length >
                      0 ? (
                        <Table
                          dataSource={detailViewRecord.leachatePondDetails}
                          rowKey={(_, i) => i}
                          size="small"
                          pagination={false}
                          columns={[
                            {
                              title: "Pond No.",
                              dataIndex: "pondNo",
                              width: 90,
                              render: (v) => v ?? "—",
                            },
                            {
                              title: "Description",
                              dataIndex: "description",
                              render: (v) =>
                                v ? (
                                  <Text
                                    ellipsis={{ tooltip: v }}
                                    style={{ maxWidth: 420, display: "block" }}
                                  >
                                    {v}
                                  </Text>
                                ) : (
                                  <Text type="secondary">—</Text>
                                ),
                            },
                            {
                              title: "Status",
                              dataIndex: "status",
                              width: 160,
                              render: (v) => (
                                <Tag
                                  color={
                                    v === "Active"
                                      ? "blue"
                                      : v === "Under Maintenance"
                                        ? "orange"
                                        : "default"
                                  }
                                >
                                  {v || "—"}
                                </Tag>
                              ),
                            },
                          ]}
                        />
                      ) : (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={
                            Number(detailViewRecord.noOfLeachatePond || 0) > 0
                              ? `${Number(detailViewRecord.noOfLeachatePond || 0)} leachate treatment plant(s) recorded, no detail entries yet`
                              : "No leachate treatment plant recorded"
                          }
                        />
                      ),
                  },
                  {
                    key: "gas-management-details",
                    label: (
                      <span style={{ color: "#52c41a" }}>
                        <ExperimentOutlined /> Gas Management Details
                      </span>
                    ),
                    children:
                      (detailViewRecord.gasVentDetails || []).length > 0 ? (
                        <Table
                          dataSource={detailViewRecord.gasVentDetails}
                          rowKey={(_, i) => i}
                          size="small"
                          pagination={false}
                          columns={[
                            {
                              title: "Record No.",
                              dataIndex: "ventNo",
                              width: 100,
                              render: (v) => v ?? "—",
                            },
                            {
                              title: "Type",
                              dataIndex: "ventType",
                              width: 140,
                              render: (v) => v || "—",
                            },
                            {
                              title: "Description",
                              dataIndex: "description",
                              render: (v) =>
                                v ? (
                                  <Text
                                    ellipsis={{ tooltip: v }}
                                    style={{ maxWidth: 360, display: "block" }}
                                  >
                                    {v}
                                  </Text>
                                ) : (
                                  <Text type="secondary">—</Text>
                                ),
                            },
                            {
                              title: "Status",
                              dataIndex: "status",
                              width: 160,
                              render: (v) => (
                                <Tag
                                  color={
                                    v === "Active"
                                      ? "green"
                                      : v === "Under Maintenance"
                                        ? "orange"
                                        : "default"
                                  }
                                >
                                  {v || "—"}
                                </Tag>
                              ),
                            },
                          ]}
                        />
                      ) : (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={
                            Number(detailViewRecord.numberOfGasVents || 0) > 0
                              ? `${Number(detailViewRecord.numberOfGasVents || 0)} gas management record(s) recorded, no detail entries yet`
                              : "No gas management details recorded"
                          }
                        />
                      ),
                  },
                  {
                    key: "permits",
                    label: (
                      <span style={{ color: "#faad14" }}>
                        <SafetyCertificateOutlined /> Permits
                      </span>
                    ),
                    children: (
                      <>
                        <Descriptions
                          column={2}
                          size="small"
                          bordered
                          style={{ marginBottom: 12 }}
                        >
                          <Descriptions.Item label="ECC No.">
                            {detailViewRecord.eccNo || "—"}
                          </Descriptions.Item>
                          <Descriptions.Item label="Hazwaste Gen. ID">
                            {detailViewRecord.hazwasteGenerationId || "—"}
                          </Descriptions.Item>
                          {detailViewRecord.slfGenerator && (
                            <Descriptions.Item label="Portal Link" span={2}>
                              <Tag color="blue" icon={<LinkOutlined />}>
                                {typeof detailViewRecord.slfGenerator ===
                                "object"
                                  ? detailViewRecord.slfGenerator.slfName
                                  : "Linked Generator"}
                              </Tag>
                            </Descriptions.Item>
                          )}
                        </Descriptions>
                        <Divider plain orientation="left">
                          Discharge Permits
                        </Divider>
                        <Table
                          size="small"
                          pagination={false}
                          dataSource={
                            detailViewRecord.dischargePermits?.length
                              ? detailViewRecord.dischargePermits
                              : detailViewRecord.dischargePermit
                                ? [
                                    {
                                      permitNo:
                                        detailViewRecord.dischargePermit,
                                      validity:
                                        detailViewRecord.dischargePermitValidity,
                                      status:
                                        detailViewRecord.dischargePermitStatus,
                                    },
                                  ]
                                : []
                          }
                          rowKey={(_, i) => i}
                          locale={{
                            emptyText: "No discharge permits recorded",
                          }}
                          columns={[
                            {
                              title: "Permit No.",
                              dataIndex: "permitNo",
                              render: (v) => v || "—",
                            },
                            {
                              title: "DP Type",
                              dataIndex: "permitType",
                              width: 150,
                              render: (v) => v || "—",
                            },
                            {
                              title: "Validity",
                              dataIndex: "validity",
                              width: 160,
                              render: (v) =>
                                v ? dayjs(v).format("MM/DD/YYYY") : "—",
                            },
                            {
                              title: "Status",
                              dataIndex: "status",
                              width: 130,
                              render: (v) => (v ? <Tag>{v}</Tag> : "—"),
                            },
                          ]}
                        />
                        <Divider
                          plain
                          orientation="left"
                          style={{ marginTop: 16 }}
                        >
                          Permits to Operate
                        </Divider>
                        <Table
                          size="small"
                          pagination={false}
                          dataSource={
                            detailViewRecord.permitToOperatePermits?.length
                              ? detailViewRecord.permitToOperatePermits
                              : detailViewRecord.permitToOperate
                                ? [
                                    {
                                      permitNo:
                                        detailViewRecord.permitToOperate,
                                      validity:
                                        detailViewRecord.permitToOperateValidity,
                                      status:
                                        detailViewRecord.permitToOperateStatus,
                                    },
                                  ]
                                : []
                          }
                          rowKey={(_, i) => i}
                          locale={{
                            emptyText: "No permits to operate recorded",
                          }}
                          columns={[
                            {
                              title: "Permit No.",
                              dataIndex: "permitNo",
                              render: (v) => v || "—",
                            },
                            {
                              title: "Validity",
                              dataIndex: "validity",
                              width: 160,
                              render: (v) =>
                                v ? dayjs(v).format("MM/DD/YYYY") : "—",
                            },
                            {
                              title: "Status",
                              dataIndex: "status",
                              width: 130,
                              render: (v) => (v ? <Tag>{v}</Tag> : "—"),
                            },
                          ]}
                        />
                      </>
                    ),
                  },
                  {
                    key: "personnel-monitoring",
                    label: (
                      <span style={{ color: "#52c41a" }}>
                        <TeamOutlined /> Personnel &amp; Monitoring
                      </span>
                    ),
                    children: (
                      <Descriptions column={2} size="small" bordered>
                        <Descriptions.Item label="Target Month">
                          {detailViewRecord.targetMonth || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="ENMO">
                          {detailViewRecord.enmo || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="ESWM Focal Person">
                          {detailViewRecord.focalPerson || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="IIS Number">
                          {detailViewRecord.iisNumber || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Date of Monitoring">
                          {detailViewRecord.dateOfMonitoring
                            ? dayjs(detailViewRecord.dateOfMonitoring).format(
                                "MM/DD/YYYY",
                              )
                            : "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Report Prepared">
                          {detailViewRecord.dateReportPrepared
                            ? dayjs(detailViewRecord.dateReportPrepared).format(
                                "MM/DD/YYYY",
                              )
                            : "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Reviewed By (Staff)">
                          {detailViewRecord.dateReportReviewedStaff || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Reviewed By (Focal)">
                          {detailViewRecord.dateReportReviewedFocal || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Approved">
                          {detailViewRecord.dateReportApproved
                            ? dayjs(detailViewRecord.dateReportApproved).format(
                                "MM/DD/YYYY",
                              )
                            : "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Days to Prepare">
                          {detailViewRecord.totalDaysReportPrepared ?? "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Days Staff Review">
                          {detailViewRecord.totalDaysReviewedStaff ?? "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Days Focal Review">
                          {detailViewRecord.totalDaysReviewedFocal ?? "—"}
                        </Descriptions.Item>
                      </Descriptions>
                    ),
                  },
                  {
                    key: "4",
                    label: (
                      <span style={{ color: "#eb2f96" }}>
                        <FileTextOutlined /> Compliance
                      </span>
                    ),
                    children: (
                      <Descriptions column={2} size="small" bordered>
                        <Descriptions.Item
                          label="Other Findings and Observations"
                          span={2}
                        >
                          {detailViewRecord.findings || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item
                          label="Remarks and Recommendation"
                          span={2}
                        >
                          {detailViewRecord.remarksAndRecommendation || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Technical Conference">
                          {detailViewRecord.technicalConferenceConducted ? (
                            <Tag color="success">Yes</Tag>
                          ) : (
                            <Tag>No</Tag>
                          )}
                        </Descriptions.Item>
                        <Descriptions.Item label="Commitment File">
                          {(detailViewRecord.commitmentFiles || []).length ? (
                            <Tag color="blue">
                              {detailViewRecord.commitmentFiles.length} file(s)
                            </Tag>
                          ) : (
                            "—"
                          )}
                        </Descriptions.Item>
                        <Descriptions.Item label="Progress Report" span={2}>
                          {(detailViewRecord.progressReportFiles || [])
                            .length ? (
                            <Tag color="geekblue">
                              {detailViewRecord.progressReportFiles.length}{" "}
                              file(s)
                            </Tag>
                          ) : (
                            "—"
                          )}
                        </Descriptions.Item>
                      </Descriptions>
                    ),
                  },
                  {
                    key: "5",
                    label: (
                      <span style={{ color: "#fa8c16" }}>
                        <WarningOutlined /> Preventive Measures
                      </span>
                    ),
                    children: (
                      <>
                        <Divider orientation="left">
                          Preventive Measure Files
                        </Divider>
                        {(detailViewRecord.preventiveMeasureFiles || [])
                          .length > 0 ? (
                          <Space size={[6, 6]} wrap>
                            {(
                              detailViewRecord.preventiveMeasureFiles || []
                            ).map((entry, i) => {
                              const url = normalizeStoredFileUrl(entry);
                              const name =
                                decodeURIComponent(
                                  String(url || "").split("/").pop() || "",
                                ).split("?")[0] || `File ${i + 1}`;
                              return url ? (
                                <a
                                  key={i}
                                  href={
                                    isDriveUrl(url) ? url : resolveMediaUrl(url)
                                  }
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Tag
                                    color="orange"
                                    icon={<LinkOutlined />}
                                    style={{ cursor: "pointer" }}
                                  >
                                    {name}
                                  </Tag>
                                </a>
                              ) : (
                                <Tag key={i} color="orange">
                                  {name}
                                </Tag>
                              );
                            })}
                          </Space>
                        ) : (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="No preventive measure files uploaded"
                          />
                        )}
                        <Divider orientation="left" style={{ marginTop: 16 }}>
                          Safe Closure and Rehabilitation Plan (SCRP)
                        </Divider>
                        {detailViewRecord.scrpDetails?.length > 0 ? (
                          <Table
                            dataSource={detailViewRecord.scrpDetails}
                            rowKey={(_, i) => i}
                            size="small"
                            pagination={false}
                            columns={[
                              {
                                title: "Plan / Activity",
                                dataIndex: "planTitle",
                                render: (v) => v || "—",
                              },
                              {
                                title: "Status",
                                dataIndex: "status",
                                width: 150,
                                render: (v) =>
                                  v ? <Tag color="blue">{v}</Tag> : "—",
                              },
                              {
                                title: "Remarks",
                                dataIndex: "remarks",
                                render: (v) => v || "—",
                              },
                              {
                                title: "Attachments",
                                dataIndex: "attachments",
                                width: 160,
                                render: (v) =>
                                  (v || []).length ? (
                                    <Space size={[4, 4]} wrap>
                                      {(v || []).map((att, ai) => {
                                        const url = normalizeStoredFileUrl(att);
                                        if (!url) return null;
                                        return (
                                          <a
                                            key={ai}
                                            href={isDriveUrl(url) ? url : resolveMediaUrl(url)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                          >
                                            <Tag color="purple" icon={<LinkOutlined />} style={{ cursor: "pointer" }}>
                                              File {ai + 1}
                                            </Tag>
                                          </a>
                                        );
                                      })}
                                    </Space>
                                  ) : (
                                    "—"
                                  ),
                              },
                            ]}
                          />
                        ) : (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="No SCRP entries recorded"
                          />
                        )}
                      </>
                    ),
                  },
                  {
                    key: "gallery",
                    label: (
                      <span style={{ color: "#1677ff" }}>
                        <FileImageOutlined /> Gallery
                      </span>
                    ),
                    children: (() => {
                      const structured = detailViewRecord.galleryItems || [];
                      const legacy = (detailViewRecord.galleryPhotos || []).map(
                        (url) => ({
                          url,
                          component: "Legacy Photos",
                          folder: "General",
                          caption: "",
                        }),
                      );
                      const photos = [...structured, ...legacy].filter(
                        (item) => item.url,
                      );
                      if (!photos.length)
                        return (
                          <Empty description="No gallery photos uploaded yet" />
                        );
                      const groups = photos.reduce((map, item) => {
                        const key = `${item.folder || "General"} / ${item.component || "SLF Component"}`;
                        if (!map[key]) map[key] = [];
                        map[key].push(item);
                        return map;
                      }, {});
                      const fileName = (item) =>
                        item.caption ||
                        decodeURIComponent(
                          String(item.url || "").split("/").pop() || "Photo",
                        ).split("?")[0];
                      return (
                        <>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              marginBottom: 12,
                              flexWrap: "wrap",
                              gap: 8,
                            }}
                          >
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {photos.length} media file(s) — click any item to open in a new tab.
                            </Text>
                            <Segmented
                              size="small"
                              value={galleryViewMode}
                              onChange={setGalleryViewMode}
                              options={[
                                { label: "Tiled", value: "tiled", icon: <AppstoreOutlined /> },
                                { label: "List", value: "list", icon: <UnorderedListOutlined /> },
                              ]}
                            />
                          </div>
                          <Image.PreviewGroup>
                            <Space
                              direction="vertical"
                              size={14}
                              style={{ width: "100%" }}
                            >
                              {Object.entries(groups).map(([group, items]) =>
                                galleryViewMode === "list" ? (
                                  <div key={group}>
                                    <Divider plain orientation="left" style={{ marginTop: 0 }}>
                                      {group}
                                    </Divider>
                                    <List
                                      size="small"
                                      dataSource={items}
                                      renderItem={(item) => (
                                        <List.Item
                                          actions={[
                                            <a
                                              key="open"
                                              href={resolveMediaUrl(item.url)}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                            >
                                              <LinkOutlined /> Open in new tab
                                            </a>,
                                          ]}
                                        >
                                          <List.Item.Meta
                                            avatar={
                                              <Image
                                                src={resolveMediaUrl(item.url, { thumbnail: true })}
                                                preview={{ src: resolveMediaUrl(item.url) }}
                                                width={64}
                                                height={48}
                                                style={{ objectFit: "cover", borderRadius: 4 }}
                                                fallback="data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='48'%3E%3Crect width='100%25' height='100%25' fill='%23f0f0f0'/%3E%3C/svg%3E"
                                              />
                                            }
                                            title={<Text style={{ fontSize: 12 }}>{fileName(item)}</Text>}
                                            description={
                                              <Text type="secondary" style={{ fontSize: 11 }}>
                                                {item.folder || "General"} · {item.component || "SLF Component"}
                                              </Text>
                                            }
                                          />
                                        </List.Item>
                                      )}
                                    />
                                  </div>
                                ) : (
                                  <div key={group}>
                                    <Divider plain orientation="left" style={{ marginTop: 0 }}>
                                      {group}
                                    </Divider>
                                    <Row gutter={[8, 8]}>
                                      {items.map((item, i) => (
                                        <Col key={`${item.url}-${i}`} xs={12} sm={8} md={6}>
                                          <Image
                                            src={resolveMediaUrl(item.url, { thumbnail: true })}
                                            preview={{ src: resolveMediaUrl(item.url) }}
                                            fallback="data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='110'%3E%3Crect width='100%25' height='100%25' fill='%23f0f0f0'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23999' font-size='12' font-family='sans-serif'%3EImage unavailable%3C/text%3E%3C/svg%3E"
                                            style={{
                                              width: "100%",
                                              borderRadius: 6,
                                              objectFit: "cover",
                                              height: 110,
                                            }}
                                          />
                                          <a
                                            href={resolveMediaUrl(item.url)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{ fontSize: 11, display: "inline-block", marginTop: 4 }}
                                          >
                                            <LinkOutlined /> Open
                                          </a>
                                          {item.caption && (
                                            <Text
                                              type="secondary"
                                              style={{ display: "block", fontSize: 11 }}
                                            >
                                              {item.caption}
                                            </Text>
                                          )}
                                        </Col>
                                      ))}
                                    </Row>
                                  </div>
                                ),
                              )}
                            </Space>
                          </Image.PreviewGroup>
                        </>
                      );
                    })(),
                  },
                  {
                    key: "documents",
                    label: (
                      <span style={{ color: "#722ed1" }}>
                        <FolderOutlined /> Documents
                      </span>
                    ),
                    children:
                      (detailViewRecord.slfDocuments || []).length > 0 ? (
                        <Table
                          dataSource={detailViewRecord.slfDocuments}
                          rowKey={(_, i) => i}
                          size="small"
                          pagination={false}
                          columns={[
                            {
                              title: "Title",
                              dataIndex: "title",
                              render: (v) => (
                                <Text strong style={{ fontSize: 12 }}>
                                  {v || "—"}
                                </Text>
                              ),
                            },
                            {
                              title: "Type",
                              dataIndex: "docType",
                              width: 160,
                              render: (v) =>
                                v ? <Tag color="purple">{v}</Tag> : "—",
                            },
                            {
                              title: "Description",
                              dataIndex: "description",
                              render: (v) =>
                                v ? (
                                  <Text
                                    type="secondary"
                                    style={{ fontSize: 12 }}
                                  >
                                    {v}
                                  </Text>
                                ) : (
                                  "—"
                                ),
                            },
                            {
                              title: "File",
                              dataIndex: "url",
                              width: 110,
                              render: (v, doc) => {
                                const raw = normalizeStoredFileUrl(v) || normalizeStoredFileUrl(doc?.fileUrl);
                                if (!raw) return "—";
                                const openUrl = isDriveUrl(raw)
                                  ? raw
                                  : resolveMediaUrl(raw);
                                return (
                                  <Button
                                    size="small"
                                    type="link"
                                    icon={<FilePdfOutlined />}
                                    href={openUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    Open
                                  </Button>
                                );
                              },
                            },
                          ]}
                        />
                      ) : (
                        <Empty description="No documents uploaded yet" />
                      ),
                  },
                  ...(detailViewRecord.slfGenerator
                    ? [
                        {
                          key: "6",
                          label: (
                            <span style={{ color: "#595959" }}>
                              <DatabaseOutlined /> Baseline Info
                            </span>
                          ),
                          children: loadingBaseline ? (
                            <div style={{ textAlign: "center", padding: 32 }}>
                              <Text type="secondary">
                                Loading baseline data...
                              </Text>
                            </div>
                          ) : baselineData ? (
                            <>
                              <Row gutter={[16, 12]}>
                                <Col span={24}>
                                  <Text
                                    type="secondary"
                                    style={{ fontSize: 12 }}
                                  >
                                    Last updated:{" "}
                                    {baselineData.savedAt
                                      ? dayjs(baselineData.savedAt).format(
                                          "MM/DD/YYYY h:mm A",
                                        )
                                      : "—"}
                                  </Text>
                                </Col>
                                <Col span={12}>
                                  <Card
                                    size="small"
                                    style={{ borderRadius: 8 }}
                                  >
                                    <Statistic
                                      title="Total Volume Accepted"
                                      value={
                                        baselineData.totalVolumeAccepted ?? 0
                                      }
                                      suffix={(
                                        baselineData.totalVolumeAcceptedUnit ||
                                        "m³"
                                      ).replace("m3", "m³")}
                                      precision={2}
                                    />
                                  </Card>
                                </Col>
                                <Col span={12}>
                                  <Card
                                    size="small"
                                    style={{ borderRadius: 8 }}
                                  >
                                    <Statistic
                                      title="Active Cell (Residual)"
                                      value={
                                        baselineData.activeCellResidualVolume ??
                                        0
                                      }
                                      suffix={(
                                        baselineData.activeCellResidualUnit ||
                                        "m³"
                                      ).replace("m3", "m³")}
                                      precision={2}
                                    />
                                  </Card>
                                </Col>
                                <Col span={12}>
                                  <Card
                                    size="small"
                                    style={{ borderRadius: 8 }}
                                  >
                                    <Statistic
                                      title="Active Cell (Inert)"
                                      value={
                                        baselineData.activeCellInertVolume ?? 0
                                      }
                                      suffix={(
                                        baselineData.activeCellInertUnit || "m³"
                                      ).replace("m3", "m³")}
                                      precision={2}
                                    />
                                  </Card>
                                </Col>
                                <Col span={12}>
                                  <Card
                                    size="small"
                                    style={{ borderRadius: 8 }}
                                  >
                                    <Statistic
                                      title="Closed Cell (Residual)"
                                      value={
                                        baselineData.closedCellResidualVolume ??
                                        0
                                      }
                                      suffix={(
                                        baselineData.closedCellResidualUnit ||
                                        "m³"
                                      ).replace("m3", "m³")}
                                      precision={2}
                                    />
                                  </Card>
                                </Col>
                                <Col span={12}>
                                  <Card
                                    size="small"
                                    style={{ borderRadius: 8 }}
                                  >
                                    <Statistic
                                      title="Closed Cell (Inert)"
                                      value={
                                        baselineData.closedCellInertVolume ?? 0
                                      }
                                      suffix={(
                                        baselineData.closedCellInertUnit || "m³"
                                      ).replace("m3", "m³")}
                                      precision={2}
                                    />
                                  </Card>
                                </Col>
                              </Row>
                              {baselineData.accreditedHaulers?.length > 0 && (
                                <>
                                  <Divider plain orientation="left">
                                    <TeamOutlined /> Accredited Haulers (
                                    {baselineData.accreditedHaulers.length})
                                  </Divider>
                                  <Table
                                    dataSource={baselineData.accreditedHaulers}
                                    rowKey={(_, i) => i}
                                    size="small"
                                    pagination={false}
                                    expandable={{
                                      expandedRowRender: (h) => {
                                        const vehicles = h.vehicles || [];
                                        const clients =
                                          h.privateSectorClients || [];
                                        return (
                                          <div style={{ padding: "8px 0" }}>
                                            {vehicles.length > 0 && (
                                              <>
                                                <Text
                                                  strong
                                                  style={{
                                                    fontSize: 12,
                                                    color: "#1677ff",
                                                  }}
                                                >
                                                  Registered Vehicles
                                                </Text>
                                                <Table
                                                  className="hauler-wrap-table"
                                                  dataSource={vehicles}
                                                  rowKey={(_, vi) => vi}
                                                  size="small"
                                                  pagination={false}
                                                  style={{
                                                    marginTop: 6,
                                                    marginBottom: 10,
                                                  }}
                                                  columns={[
                                                    {
                                                      title: "Plate No.",
                                                      dataIndex: "plateNumber",
                                                      width: 120,
                                                      render: (v) => v || "—",
                                                    },
                                                    {
                                                      title: "Type",
                                                      dataIndex: "vehicleType",
                                                      width: 130,
                                                      render: (v) =>
                                                        v ? (
                                                          <Tag color="geekblue">
                                                            {v}
                                                          </Tag>
                                                        ) : (
                                                          "—"
                                                        ),
                                                    },
                                                    {
                                                      title: "Capacity",
                                                      width: 140,
                                                      render: (_, v) =>
                                                        v.capacity
                                                          ? `${Number(v.capacity).toLocaleString()} ${v.capacityUnit || "m³"}`
                                                          : "—",
                                                    },
                                                  ]}
                                                />
                                              </>
                                            )}
                                            {clients.length > 0 && (
                                              <>
                                                <Text
                                                  strong
                                                  style={{
                                                    fontSize: 12,
                                                    color: "#52c41a",
                                                  }}
                                                >
                                                  Private Sector Clients
                                                </Text>
                                                <Table
                                                  className="hauler-wrap-table"
                                                  dataSource={clients}
                                                  rowKey={(_, ci) => ci}
                                                  size="small"
                                                  pagination={false}
                                                  style={{ marginTop: 6 }}
                                                  columns={[
                                                    {
                                                      title: "Client Name",
                                                      dataIndex: "clientName",
                                                      render: (v) => v || "—",
                                                    },
                                                    {
                                                      title: "Type",
                                                      dataIndex: "clientType",
                                                      width: 100,
                                                      render: (v) =>
                                                        v ? (
                                                          <Tag
                                                            color={
                                                              v === "LGU"
                                                                ? "blue"
                                                                : "purple"
                                                            }
                                                          >
                                                            {v}
                                                          </Tag>
                                                        ) : (
                                                          "—"
                                                        ),
                                                    },
                                                    {
                                                      title: "Province",
                                                      dataIndex: "province",
                                                      width: 120,
                                                      render: (v) => v || "—",
                                                    },
                                                    {
                                                      title: "Municipality",
                                                      dataIndex: "municipality",
                                                      width: 140,
                                                      render: (v) => v || "—",
                                                    },
                                                    {
                                                      title: "Trips/Month",
                                                      dataIndex:
                                                        "noOfTripsPerMonth",
                                                      width: 110,
                                                      align: "center",
                                                      render: (v) => v ?? "—",
                                                    },
                                                  ]}
                                                />
                                              </>
                                            )}
                                            {vehicles.length === 0 &&
                                              clients.length === 0 && (
                                                <Text
                                                  type="secondary"
                                                  style={{ fontSize: 12 }}
                                                >
                                                  No vehicle or client details
                                                  recorded.
                                                </Text>
                                              )}
                                          </div>
                                        );
                                      },
                                      rowExpandable: (h) =>
                                        (h.vehicles?.length || 0) > 0 ||
                                        (h.privateSectorClients?.length || 0) >
                                          0,
                                    }}
                                    columns={[
                                      {
                                        title: "Hauler Name",
                                        dataIndex: "haulerName",
                                        key: "haulerName",
                                        render: (v) => (
                                          <Text strong style={{ fontSize: 12 }}>
                                            {v || "—"}
                                          </Text>
                                        ),
                                      },
                                      {
                                        title: "No. of Trucks",
                                        dataIndex: "numberOfTrucks",
                                        key: "numberOfTrucks",
                                        width: 110,
                                        align: "center",
                                        render: (v) =>
                                          v != null ? (
                                            <Tag color="blue">{v}</Tag>
                                          ) : (
                                            "—"
                                          ),
                                      },
                                      {
                                        title: "Office Address",
                                        key: "officeAddr",
                                        render: (_, h) => {
                                          const parts = [
                                            h.officeBarangay,
                                            h.officeCity,
                                            h.officeProvince,
                                          ].filter(Boolean);
                                          return parts.length > 0
                                            ? parts.join(", ")
                                            : h.officeAddress || "—";
                                        },
                                      },
                                      {
                                        title: "Vehicles",
                                        key: "vehicleCount",
                                        width: 90,
                                        align: "center",
                                        render: (_, h) =>
                                          (h.vehicles?.length || 0) > 0 ? (
                                            <Tag color="geekblue">
                                              {h.vehicles.length}
                                            </Tag>
                                          ) : (
                                            <Text type="secondary">—</Text>
                                          ),
                                      },
                                      {
                                        title: "Clients",
                                        key: "clientCount",
                                        width: 80,
                                        align: "center",
                                        render: (_, h) =>
                                          (h.privateSectorClients?.length ||
                                            0) > 0 ? (
                                            <Tag color="green">
                                              {h.privateSectorClients.length}
                                            </Tag>
                                          ) : (
                                            <Text type="secondary">—</Text>
                                          ),
                                      },
                                    ]}
                                  />
                                </>
                              )}
                            </>
                          ) : (
                            <div style={{ textAlign: "center", padding: 32 }}>
                              <Text type="secondary">
                                No baseline data submitted yet for this SLF.
                              </Text>
                            </div>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            ) : (
              <div style={{ textAlign: "center", padding: 48 }}>
                <Empty description="No record found for this year" />
              </div>
            )}
          </>
        )}
      </Modal>

      {renderInsightModal()}

      {/* -- LGU Served Drill-Down Modal -- */}
      <Modal
        open={slfLguModal}
        onCancel={() => setSlfLguModal(false)}
        title={
          <Space>
            <TeamOutlined style={{ color: "#fa8c16" }} />

        <Modal
          title={
            <Space>
              <BellOutlined style={{ color: "#fa8c16" }} />
              <span>Notify Assigned SLF Users</span>
            </Space>
          }
          open={!!capacityAlertModal?.open}
          onCancel={() => setCapacityAlertModal(null)}
          onOk={sendCapacityAlert}
          okText="Send Notification"
          confirmLoading={capacityAlertSending}
          width={620}
          destroyOnHidden
        >
          {capacityAlertModal?.cell && (
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Alert
                type="warning"
                showIcon
                message={`${capacityAlertModal.record?.lgu || "SLF"} Cell ${capacityAlertModal.cell.index + 1} is ${capacityAlertModal.cell.pct}% full`}
                description="This sends a portal notification to users assigned to this SLF and also creates an admin notification."
              />
              <Input.TextArea
                rows={5}
                value={capacityAlertModal.message}
                onChange={(event) =>
                  setCapacityAlertModal((prev) => ({
                    ...prev,
                    message: event.target.value,
                  }))
                }
                placeholder="Write the notification message for assigned SLF users"
              />
            </Space>
          )}
        </Modal>
            <Text strong>LGU Served — SLF Details</Text>
          </Space>
        }
        footer={
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Button onClick={() => setSlfLguModal(false)}>Close</Button>
            <Button
              type="primary"
              icon={<TableOutlined />}
              onClick={() => setSlfLguModal(false)}
            >
              See More Details in Table
            </Button>
          </div>
        }
        width={1050}
        destroyOnHidden
      >
        {(() => {
          const lguData = records.filter(
            (r) => Number(r.noOfLGUServed || 0) > 0,
          );
          const inR3 = lguData.filter((r) => R3_PROVINCES.includes(r.province));
          const outR3 = lguData.filter(
            (r) => !R3_PROVINCES.includes(r.province),
          );
          const totalInR3 = inR3.reduce(
            (s, r) => s + (r.noOfLGUServed || 0),
            0,
          );
          const totalOutR3 = outR3.reduce(
            (s, r) => s + (r.noOfLGUServed || 0),
            0,
          );
          const cols = [
            {
              title: "SLF / LGU",
              dataIndex: "lgu",
              key: "lgu",
              width: 180,
              render: (v, r) => (
                <Text strong style={{ fontSize: 12 }}>
                  {v}
                  {r.barangay ? (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {" "}
                      ({r.barangay})
                    </Text>
                  ) : (
                    ""
                  )}
                </Text>
              ),
            },
            {
              title: "Province",
              dataIndex: "province",
              key: "province",
              width: 120,
              render: (v) => <Tag color="geekblue">{v || "—"}</Tag>,
            },
            {
              title: "No. of LGUs Served",
              dataIndex: "noOfLGUServed",
              key: "noOfLGUServed",
              width: 140,
              align: "center",
              render: (v) => (
                <Badge
                  count={v}
                  color="#fa8c16"
                  overflowCount={999}
                  style={{ fontWeight: 700 }}
                />
              ),
            },
            {
              title: "Status",
              dataIndex: "statusOfSLF",
              key: "statusOfSLF",
              width: 130,
              render: (v) => getStatusTag(v),
            },
            {
              title: "Ownership",
              dataIndex: "ownership",
              key: "ownership",
              width: 130,
              render: (v) => v || "—",
            },
            {
              title: "Category",
              dataIndex: "category",
              key: "category",
              width: 80,
              align: "center",
              render: (v) => (v ? <Tag color="purple">{v}</Tag> : "—"),
            },
          ];
          const summary = (data) => {
            const tot = data.reduce((s, r) => s + (r.noOfLGUServed || 0), 0);
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell colSpan={2} index={0}>
                  <Text strong>Total</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="center">
                  <Text strong style={{ color: "#fa8c16" }}>
                    {tot}
                  </Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell colSpan={3} index={3} />
              </Table.Summary.Row>
            );
          };
          return (
            <Tabs
              defaultActiveKey="r3"
              items={[
                {
                  key: "r3",
                  label: (
                    <span>
                      <EnvironmentOutlined /> Within Region 3{" "}
                      <Badge
                        count={totalInR3}
                        color="#fa8c16"
                        overflowCount={999}
                        style={{ marginLeft: 4 }}
                      />
                    </span>
                  ),
                  children:
                    inR3.length > 0 ? (
                      <>
                        <Row gutter={16} style={{ marginBottom: 12 }}>
                          <Col span={8}>
                            <Card
                              size="small"
                              style={{
                                borderRadius: 8,
                                background: "#fff7e6",
                                borderColor: "#ffd591",
                              }}
                            >
                              <Statistic
                                title="SLF Facilities"
                                value={inR3.length}
                                valueStyle={{ color: "#fa8c16", fontSize: 22 }}
                              />
                            </Card>
                          </Col>
                          <Col span={8}>
                            <Card
                              size="small"
                              style={{
                                borderRadius: 8,
                                background: "#fff7e6",
                                borderColor: "#ffd591",
                              }}
                            >
                              <Statistic
                                title="Total LGUs Served"
                                value={totalInR3}
                                valueStyle={{ color: "#fa8c16", fontSize: 22 }}
                              />
                            </Card>
                          </Col>
                          <Col span={8}>
                            <Card
                              size="small"
                              style={{
                                borderRadius: 8,
                                background: "#fff7e6",
                                borderColor: "#ffd591",
                              }}
                            >
                              <Statistic
                                title="Avg LGUs/SLF"
                                value={(totalInR3 / inR3.length).toFixed(1)}
                                valueStyle={{ color: "#fa8c16", fontSize: 22 }}
                              />
                            </Card>
                          </Col>
                        </Row>
                        <Table
                          dataSource={inR3}
                          rowKey="_id"
                          size="small"
                          columns={cols}
                          pagination={{ pageSize: 10, showSizeChanger: true }}
                          scroll={{ x: "max-content" }}
                          summary={summary}
                        />
                      </>
                    ) : (
                      <Empty description="No SLF data within Region 3 reporting LGU services" />
                    ),
                },
                {
                  key: "out",
                  label: (
                    <span>
                      <EnvironmentOutlined /> Outside Region 3{" "}
                      <Badge
                        count={totalOutR3}
                        color="#1890ff"
                        overflowCount={999}
                        style={{ marginLeft: 4 }}
                      />
                    </span>
                  ),
                  children:
                    outR3.length > 0 ? (
                      <>
                        <Row gutter={16} style={{ marginBottom: 12 }}>
                          <Col span={8}>
                            <Card
                              size="small"
                              style={{
                                borderRadius: 8,
                                background: "#e6f7ff",
                                borderColor: "#91d5ff",
                              }}
                            >
                              <Statistic
                                title="SLF Facilities"
                                value={outR3.length}
                                valueStyle={{ color: "#1890ff", fontSize: 22 }}
                              />
                            </Card>
                          </Col>
                          <Col span={8}>
                            <Card
                              size="small"
                              style={{
                                borderRadius: 8,
                                background: "#e6f7ff",
                                borderColor: "#91d5ff",
                              }}
                            >
                              <Statistic
                                title="Total LGUs Served"
                                value={totalOutR3}
                                valueStyle={{ color: "#1890ff", fontSize: 22 }}
                              />
                            </Card>
                          </Col>
                          <Col span={8}>
                            <Card
                              size="small"
                              style={{
                                borderRadius: 8,
                                background: "#e6f7ff",
                                borderColor: "#91d5ff",
                              }}
                            >
                              <Statistic
                                title="Avg LGUs/SLF"
                                value={(totalOutR3 / outR3.length).toFixed(1)}
                                valueStyle={{ color: "#1890ff", fontSize: 22 }}
                              />
                            </Card>
                          </Col>
                        </Row>
                        <Table
                          dataSource={outR3}
                          rowKey="_id"
                          size="small"
                          columns={cols}
                          pagination={{ pageSize: 10, showSizeChanger: true }}
                          scroll={{ x: "max-content" }}
                          summary={summary}
                        />
                      </>
                    ) : (
                      <Empty description="No SLF data outside Region 3 reporting LGU services" />
                    ),
                },
              ]}
            />
          );
        })()}
      </Modal>

      {/* -- Waste Received Drill-Down Modal -- */}
      <Modal
        open={slfWasteModal}
        onCancel={() => setSlfWasteModal(false)}
        title={
          <Space>
            <BarChartOutlined style={{ color: "#ff4d4f" }} />
            <Text strong>Waste Received — SLF Details</Text>
          </Space>
        }
        footer={
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Button onClick={() => setSlfWasteModal(false)}>Close</Button>
            <Button
              type="primary"
              icon={<TableOutlined />}
              onClick={() => setSlfWasteModal(false)}
            >
              See More Details in Table
            </Button>
          </div>
        }
        width={1100}
        destroyOnHidden
      >
        {(() => {
          const wasteData = records.filter(
            (r) => Number(r.actualResidualWasteReceived || 0) > 0,
          );
          const r3Lgus = wasteData.filter(
            (r) =>
              R3_PROVINCES.includes(r.province) &&
              !/private/i.test(r.ownership || ""),
          );
          const outLgus = wasteData.filter(
            (r) =>
              !R3_PROVINCES.includes(r.province) &&
              !/private/i.test(r.ownership || ""),
          );
          const privates = wasteData.filter((r) =>
            /private/i.test(r.ownership || ""),
          );
          const toBarData = (arr) =>
            arr
              .map((r) => ({
                name: r.lgu || r.province || "Unknown",
                waste: r.actualResidualWasteReceived || 0,
                province: r.province || "—",
                status: r.statusOfSLF || "—",
              }))
              .sort((a, b) => b.waste - a.waste);
          const WasteSection = ({ data, color, label }) => {
            const barData = toBarData(data);
            const total = barData.reduce((s, d) => s + d.waste, 0);
            if (barData.length === 0)
              return (
                <Empty
                  description={`No ${label} waste data available`}
                  style={{ padding: 24 }}
                />
              );
            return (
              <div style={{ marginBottom: 20 }}>
                <Row gutter={12} style={{ marginBottom: 10 }}>
                  <Col span={8}>
                    <Card
                      size="small"
                      style={{
                        borderRadius: 8,
                        background: `${color}0d`,
                        border: `1px solid ${color}40`,
                      }}
                    >
                      <Statistic
                        title="SLF Facilities"
                        value={barData.length}
                        valueStyle={{ color, fontSize: 20 }}
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card
                      size="small"
                      style={{
                        borderRadius: 8,
                        background: `${color}0d`,
                        border: `1px solid ${color}40`,
                      }}
                    >
                      <Statistic
                        title="Total Waste Received"
                        value={total.toLocaleString()}
                        valueStyle={{ color, fontSize: 20 }}
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card
                      size="small"
                      style={{
                        borderRadius: 8,
                        background: `${color}0d`,
                        border: `1px solid ${color}40`,
                      }}
                    >
                      <Statistic
                        title="Avg/Facility"
                        value={(total / barData.length).toLocaleString(
                          undefined,
                          { maximumFractionDigits: 0 },
                        )}
                        valueStyle={{ color, fontSize: 20 }}
                      />
                    </Card>
                  </Col>
                </Row>
                <ResponsiveContainer
                  width="100%"
                  height={Math.max(160, barData.length * 30)}
                >
                  <BarChart
                    data={barData}
                    layout="vertical"
                    margin={{ top: 4, right: 40, bottom: 4, left: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) =>
                        v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v
                      }
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={130}
                      tick={{ fontSize: 11 }}
                    />
                    <RTooltip
                      formatter={(v) => [
                        `${Number(v).toLocaleString()} tons`,
                        "Waste Received",
                      ]}
                    />
                    <Bar
                      dataKey="waste"
                      fill={color}
                      radius={[0, 4, 4, 0]}
                      label={{
                        position: "right",
                        fontSize: 10,
                        formatter: (v) =>
                          v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v,
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            );
          };
          return (
            <Tabs
              defaultActiveKey="r3"
              items={[
                {
                  key: "r3",
                  label: (
                    <span>
                      <EnvironmentOutlined /> Region 3 LGUs ({r3Lgus.length})
                    </span>
                  ),
                  children: (
                    <WasteSection
                      data={r3Lgus}
                      color="#52c41a"
                      label="Region 3 LGU"
                    />
                  ),
                },
                {
                  key: "out",
                  label: (
                    <span>
                      <EnvironmentOutlined /> Outside Region 3 ({outLgus.length}
                      )
                    </span>
                  ),
                  children: (
                    <WasteSection
                      data={outLgus}
                      color="#1890ff"
                      label="outside Region 3 LGU"
                    />
                  ),
                },
                {
                  key: "private",
                  label: (
                    <span>
                      <BankOutlined /> Private Industries ({privates.length})
                    </span>
                  ),
                  children: (
                    <WasteSection
                      data={privates}
                      color="#722ed1"
                      label="private industry"
                    />
                  ),
                },
              ]}
            />
          );
        })()}
      </Modal>
      <Modal
        title={
          <Space>
            <DatabaseOutlined />
            Daily Submissions - {dailySubmissionsModal.cell?.cellName || "Cell"}
          </Space>
        }
        open={dailySubmissionsModal.open}
        onCancel={() => setDailySubmissionsModal({ open: false, cell: null, rows: [] })}
        footer={<Button onClick={() => setDailySubmissionsModal({ open: false, cell: null, rows: [] })}>Close</Button>}
        width={980}
        destroyOnHidden
      >
        <Table
          className="portal-user-wrap-table"
          size="small"
          rowKey="key"
          dataSource={dailySubmissionsModal.rows}
          pagination={{ pageSize: 8, size: "small" }}
          scroll={{ x: 900 }}
          locale={{ emptyText: "No daily portal submissions found for this cell" }}
          columns={[
            {
              title: "Date Submitted",
              width: 150,
              render: (_, row) => row.submission?.createdAt ? dayjs(row.submission.createdAt).format("MM/DD/YYYY h:mm A") : "—",
            },
            {
              title: "Submission ID",
              width: 160,
              render: (_, row) => <Text strong style={{ fontSize: 12 }}>{row.submission?.idNo || row.submission?.submissionId || "—"}</Text>,
            },
            {
              title: "Waste Generator",
              width: 190,
              render: (_, row) => (
                <Text style={{ fontSize: 12, whiteSpace: "normal", wordBreak: "break-word" }}>
                  {row.submission?.lguCompanyName || row.submission?.companyName || "—"}
                </Text>
              ),
            },
            {
              title: "Truck / Ticket",
              width: 160,
              render: (_, row) => (
                <Space direction="vertical" size={0}>
                  <Text style={{ fontSize: 12 }}>{row.truck?.plateNumber || "No plate"}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>{row.truck?.disposalTicketNo || row.truck?.ticketNo || "No ticket"}</Text>
                </Space>
              ),
            },
            {
              title: "Waste Type",
              width: 160,
              render: (_, row) => <Tag color={isHazardousCellType(row.truck?.wasteType) ? "red" : "blue"}>{row.truck?.wasteType || "Residual"}</Tag>,
            },
            {
              title: "Volume",
              width: 130,
              align: "right",
              render: (_, row) => `${Number(row.truck?.actualVolume || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${normalizeUnit(row.truck?.actualVolumeUnit || dailySubmissionsModal.cell?.unit || "tons")}`,
            },
            {
              title: "Status",
              width: 120,
              render: (_, row) => <Tag>{row.submission?.status || "pending"}</Tag>,
            },
          ]}
        />
      </Modal>
      <Modal
        title={<Space><HistoryOutlined />Submission History and Cell Placement</Space>}
        open={!!cellAssignmentModal}
        onCancel={() => setCellAssignmentModal(null)}
        width={980}
        footer={[
          <Button key="close" onClick={() => setCellAssignmentModal(null)}>Close</Button>,
          <Button
            key="save"
            type="primary"
            loading={cellAssignmentSaving}
            onClick={saveCellAssignments}
            disabled={
              !cellAssignmentModal?.selectedId ||
              getActiveCellOptions().length === 0
            }
          >
            Save Placement
          </Button>,
        ]}
        destroyOnHidden
      >
        {cellAssignmentModal && (() => {
          const activeCells = getActiveCellOptions();
          const selected = (cellAssignmentModal.submissions || []).find(
            (submission) => submission._id === cellAssignmentModal.selectedId,
          );
          return (
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Alert
                type={activeCells.length === 0 ? "warning" : "info"}
                showIcon
                message={
                  activeCells.length === 0
                    ? "No active cells are available. Turn on at least one cell before assigning submitted truck volumes."
                    : "Assign each submitted truck volume to the active cell where the waste was actually placed."
                }
              />
              <Row gutter={12}>
                <Col xs={24} md={9}>
                  <List
                    size="small"
                    bordered
                    style={{ maxHeight: 420, overflowY: "auto" }}
                    dataSource={cellAssignmentModal.submissions || []}
                    locale={{ emptyText: "No portal submissions found for this SLF" }}
                    renderItem={(submission) => (
                      <List.Item
                        onClick={() => setCellAssignmentModal((prev) => ({ ...prev, selectedId: submission._id }))}
                        style={{
                          cursor: "pointer",
                          background: submission._id === cellAssignmentModal.selectedId
                            ? (isDark ? "rgba(22,119,255,0.16)" : "#e6f4ff")
                            : "transparent",
                        }}
                      >
                        <List.Item.Meta
                          avatar={<Avatar icon={<FileTextOutlined />} />}
                          title={<Text strong>{submission.idNo || "No ID"}</Text>}
                          description={`${submission.lguCompanyName || "Unnamed"} - ${submission.createdAt ? dayjs(submission.createdAt).format("MM/DD/YYYY") : "No date"}`}
                        />
                      </List.Item>
                    )}
                  />
                </Col>
                <Col xs={24} md={15}>
                  {!selected ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Select a submission" />
                  ) : (() => {
                    // Flatten trucks → per-vehicle rows so each vehicle's waste
                    // can be placed in its own active cell (matches portal model).
                    const placementRows = [];
                    (selected.trucks || []).forEach((truck, truckIndex) => {
                      if (Array.isArray(truck.vehicles) && truck.vehicles.length > 0) {
                        truck.vehicles.forEach((veh, vehicleIndex) => {
                          placementRows.push({
                            rowKey: `${truckIndex}-${vehicleIndex}`,
                            truckIndex,
                            vehicleIndex,
                            plate: veh.plateNumber || truck.disposalTicketNo || "-",
                            wasteType: veh.wasteType || truck.wasteType || "Residual",
                            volume: veh.actualVolume != null ? veh.actualVolume : truck.actualVolume,
                            volumeUnit: veh.actualVolumeUnit || truck.actualVolumeUnit || "tons",
                            cellSource: veh,
                          });
                        });
                      } else {
                        placementRows.push({
                          rowKey: `${truckIndex}-t`,
                          truckIndex,
                          vehicleIndex: null,
                          plate: truck.plateNumber || truck.disposalTicketNo || "-",
                          wasteType: truck.wasteType || "Residual",
                          volume: truck.actualVolume,
                          volumeUnit: truck.actualVolumeUnit || "tons",
                          cellSource: truck,
                        });
                      }
                    });
                    return (
                    <Table
                      className="portal-user-wrap-table"
                      size="small"
                      rowKey="rowKey"
                      pagination={false}
                      dataSource={placementRows}
                      locale={{
                        emptyText: "No truck records found in this portal submission",
                      }}
                      columns={[
                        { title: "Truck / Plate", width: 150, render: (_, row) => <Text>{row.plate}</Text> },
                        {
                          title: "Waste Type",
                          width: 140,
                          render: (_, row) => (
                            <Tag color={/haz|inert/i.test(row.wasteType) ? "volcano" : "green"}>
                              {row.wasteType}
                            </Tag>
                          ),
                        },
                        {
                          title: "Volume",
                          width: 110,
                          render: (_, row) => `${Number(row.volume || 0).toLocaleString()} ${normalizeUnit(row.volumeUnit)}`,
                        },
                        {
                          title: "Active Cell",
                          render: (_, row) => {
                            const compatible = activeCells.filter((cell) =>
                              /haz|inert/i.test(row.wasteType)
                                ? isHazardousCellType(cell.type)
                                : !isHazardousCellType(cell.type),
                            );
                            const cellList = compatible.length ? compatible : activeCells;
                            return (
                              <Select
                                style={{ width: "100%" }}
                                placeholder="Select active cell"
                                value={(() => {
                                  const index = getTruckCellIndex(row.cellSource);
                                  return cellList.some((cell) => cell.index === index)
                                    ? index
                                    : undefined;
                                })()}
                                options={cellList.map((cell) => ({ label: cell.label, value: cell.index }))}
                                onChange={(value) =>
                                  updateCellAssignmentLocal(
                                    selected._id,
                                    row.truckIndex,
                                    value,
                                    row.vehicleIndex,
                                  )
                                }
                                allowClear
                                disabled={activeCells.length === 0}
                              />
                            );
                          },
                        },
                      ]}
                    />
                    );
                  })()}
                </Col>
              </Row>
            </Space>
          );
        })()}
      </Modal>
    </div>
  );
}
