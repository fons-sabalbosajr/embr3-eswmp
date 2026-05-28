import { useState, useEffect, useRef, useCallback } from "react";
import {
  Layout,
  Form,
  Input,
  InputNumber,
  Button,
  Card,
  Typography,
  Result,
  Select,
  DatePicker,
  Divider,
  Row,
  Col,
  Space,
  Statistic,
  Table,
  Spin,
  Empty,
  Menu,
  Avatar,
  Dropdown,
  Tag,
  Grid,
  Drawer,
  Tabs,
  Modal,
  Descriptions,
  Badge,
  Tooltip,
  Collapse,
  Popover,
  List,
  Progress,
  Checkbox,
  Alert,
} from "antd";
import {
  CheckCircleOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  SendOutlined,
  FileTextOutlined,
  HistoryOutlined,
  LogoutOutlined,
  MenuOutlined,
  UserOutlined,
  DatabaseOutlined,
  DashboardOutlined,
  InfoCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  ReloadOutlined,
  EyeOutlined,
  UndoOutlined,
  MailOutlined,
  CarOutlined,
  EnvironmentOutlined,
  TeamOutlined,
  WifiOutlined,
  BellOutlined,
  InboxOutlined,
  MessageOutlined,
  PieChartOutlined,
  BankOutlined,
  ContainerOutlined,
  BarChartOutlined,
  DownOutlined,
  UpOutlined,
  QuestionCircleOutlined,
  CustomerServiceOutlined,
  UploadOutlined,
  FileExcelOutlined,
  AuditOutlined,
  ClockCircleOutlined,
  SaveOutlined,
  BulbOutlined,
  RocketOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
dayjs.extend(relativeTime);
import * as XLSX from "xlsx";
import {
  PieChart,
  Pie,
  Cell as RCell,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import api from "../../api";
import { useErrorCard } from "../../utils/ErrorHandler";
import secureStorage from "../../utils/secureStorage";
import { fetchWithCache, invalidateCache } from "../../utils/pageCache";
import { connectSocket, disconnectSocket } from "../../utils/socket";
import embLogo from "../../assets/emblogo.svg";
import "./SLFPortal.css";
import SLFPortalModals from "./SLFPortalModals";
import {
  EMPTY_TRUCK,
  EMPTY_HAULER,
  EMPTY_VEHICLE,
  KNOWN_TRANSPORT_KEYS,
  withRetry,
} from "./constants";

const { Text } = Typography;
const { Option } = Select;
const { Header, Sider, Content } = Layout;
const { useBreakpoint } = Grid;
const { TextArea } = Input;
const TON_PER_M3 = 0.2;
const PORTAL_SETTINGS_CACHE_KEY = "portal-settings-cache";
const PORTAL_SUBMISSIONS_CACHE_KEY = "portal-submissions-cache";
const PORTAL_WASTE_RECEIVED_CACHE_KEY = "portal-waste-received-cache";
const PORTAL_CACHE_TTL = 2 * 60 * 1000;

const normalizeUnit = (unit) => String(unit || "m³").replace("m3", "m³");
const hasBaselinePayload = (data = {}) =>
  !!(
    data &&
    (data.totalVolumeAccepted != null ||
      data.activeCellResidualVolume != null ||
      data.activeCellInertVolume != null ||
      data.activeCellHazardousVolume != null ||
      data.closedCellResidualVolume != null ||
      data.closedCellInertVolume != null ||
      data.closedCellHazardousVolume != null ||
      data.activeCellEntries?.length ||
      data.closedCellEntries?.length ||
      data.accreditedHaulers?.length)
  );
const formatEntryVolumeSummary = (entries = [], fallbackUnit = "m³") => {
  const totals = entries.reduce((acc, entry) => {
    const unit = normalizeUnit(entry.unit || fallbackUnit);
    acc[unit] = (acc[unit] || 0) + Number(entry.volume || 0);
    return acc;
  }, {});
  const summary = Object.entries(totals)
    .filter(([, volume]) => volume > 0)
    .map(([unit, volume]) => `${volume.toLocaleString()} ${unit}`)
    .join(", ");
  return summary || `0 ${normalizeUnit(fallbackUnit)}`;
};

const isTestAdminNotice = (item = {}) => {
  const isAdminNotice =
    ["admin_message", "message_from_admin", "support_ticket_reply"].includes(
      item.type,
    ) ||
    item.source === "admin_message" ||
    /message from admin|admin sent you a message/i.test(
      `${item.title || ""} ${item.subject || ""} ${item.message || ""}`,
    );
  if (!isAdminNotice) return false;
  const content =
    `${item.subject || ""} ${item.title || ""} ${item.message || ""}`
      .replace(/admin (sent you a message|replied to .*?):/gi, "")
      .trim();
  return /^(test|testing|test message|test notification|sample message)(\s*\d*)?$/i.test(
    content,
  );
};

const normalizeVehicleRecord = (vehicle = {}, fallbackUnit = "m³") => ({
  plateNumber: vehicle.plateNumber || vehicle.plateNo || vehicle.plate || "",
  vehicleType: vehicle.vehicleType || vehicle.type || "",
  capacity: vehicle.capacity ?? vehicle.truckCapacity ?? null,
  capacityUnit: normalizeUnit(
    vehicle.capacityUnit || vehicle.truckCapacityUnit || fallbackUnit,
  ),
  selectedClients: Array.isArray(vehicle.selectedClients)
    ? vehicle.selectedClients
    : [],
});

const normalizeClientRecord = (client, index = 0) => {
  if (typeof client === "string") {
    return {
      key: index,
      clientName: client,
      clientType: "Private",
      region: "",
      province: "",
      municipality: "",
    };
  }
  return { key: client?.key ?? client?._id ?? index, ...(client || {}) };
};

const normalizeHaulerRecord = (hauler = {}, index = 0, fallbackUnit = "m³") => {
  let vehicles = Array.isArray(hauler.vehicles)
    ? hauler.vehicles.map((vehicle) =>
        normalizeVehicleRecord(vehicle, fallbackUnit),
      )
    : [];
  if (
    vehicles.length === 0 &&
    (hauler.plateNumber ||
      hauler.plateNo ||
      hauler.vehicleType ||
      hauler.capacity != null)
  ) {
    vehicles = [normalizeVehicleRecord(hauler, fallbackUnit)];
  }
  const clients = Array.isArray(hauler.privateSectorClients)
    ? hauler.privateSectorClients
    : hauler.privateSectorClients
      ? [hauler.privateSectorClients]
      : Array.isArray(hauler.clients)
        ? hauler.clients
        : [];
  return {
    key: hauler.key || hauler._id || `${Date.now()}-${index}`,
    ...hauler,
    haulerName: hauler.haulerName || hauler.name || "",
    numberOfTrucks: hauler.numberOfTrucks || vehicles.length || null,
    vehicles,
    privateSectorClients: clients.map(normalizeClientRecord),
  };
};

const mergeHaulersByName = (haulers = [], fallbackUnit = "m³") => {
  const merged = new Map();
  haulers.forEach((hauler, index) => {
    const normalized = normalizeHaulerRecord(hauler, index, fallbackUnit);
    const nameKey =
      normalized.haulerName.trim().toLowerCase() || `hauler-${index}`;
    const existing = merged.get(nameKey);
    if (!existing) {
      merged.set(nameKey, normalized);
      return;
    }
    const vehicleMap = new Map(
      (existing.vehicles || []).map((vehicle, vehicleIndex) => [
        (vehicle.plateNumber || `vehicle-${vehicleIndex}`).trim().toLowerCase(),
        vehicle,
      ]),
    );
    (normalized.vehicles || []).forEach((vehicle, vehicleIndex) => {
      const plateKey = (vehicle.plateNumber || `new-${vehicleIndex}`)
        .trim()
        .toLowerCase();
      if (!vehicleMap.has(plateKey)) vehicleMap.set(plateKey, vehicle);
    });
    const clientMap = new Map(
      (existing.privateSectorClients || []).map((client, clientIndex) => [
        (client.clientName || `client-${clientIndex}`).trim().toLowerCase(),
        client,
      ]),
    );
    (normalized.privateSectorClients || []).forEach((client, clientIndex) => {
      const clientKey = (client.clientName || `new-client-${clientIndex}`)
        .trim()
        .toLowerCase();
      if (!clientMap.has(clientKey)) clientMap.set(clientKey, client);
    });
    merged.set(nameKey, {
      ...existing,
      ...normalized,
      key: existing.key,
      vehicles: Array.from(vehicleMap.values()),
      privateSectorClients: Array.from(clientMap.values()),
      numberOfTrucks: Math.max(
        Number(existing.numberOfTrucks || 0),
        Number(normalized.numberOfTrucks || 0),
        vehicleMap.size,
      ),
    });
  });
  return Array.from(merged.values());
};

const convertVolume = (value, fromUnit = "m³", toUnit = fromUnit) => {
  const number = Number(value || 0);
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit || from);
  if (!number || from === to) return number;
  if (from === "tons" && to === "m³") return number / TON_PER_M3;
  if (from === "m³" && to === "tons") return number * TON_PER_M3;
  return number;
};

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

const isUnavailableCellStatus = (status) =>
  [
    "Under Construction",
    "Reserved Area",
    "Reserved Cell",
    "Not Existed",
  ].includes(String(status || ""));

const uploadHeaderKey = (header) =>
  String(header || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const compactUploadHeaderKey = (header) =>
  uploadHeaderKey(header).replace(/[^a-z0-9]/g, "");

const isHaulerNameHeader = (header) => {
  const key = uploadHeaderKey(header);
  const compact = compactUploadHeaderKey(header);
  return (
    compact === "haulername" ||
    compact === "accreditedhauler" ||
    compact === "accreditedhaulername" ||
    (key.includes("hauler") && key.includes("name")) ||
    (key.includes("hauler") && !key.includes("truck"))
  );
};

const isNumberOfTrucksHeader = (header) => {
  const key = uploadHeaderKey(header);
  const compact = compactUploadHeaderKey(header);
  return (
    compact === "numberoftrucks" ||
    compact === "nooftrucks" ||
    compact === "truckcount" ||
    compact === "totaltrucks" ||
    compact === "numbertrucks" ||
    (key.includes("truck") && (key.includes("number") || key.includes("no.") || key.includes("no ") || key.includes("count") || key.includes("total")))
  );
};

const UPLOAD_REQUIRED_FIELDS = {
  truck: [
    {
      field: "disposalTicketNo",
      label: "Ticket No.",
      matches: (key) => key.includes("ticket") || key.includes("disposal"),
    },
    {
      field: "hauler",
      label: "Hauler",
      matches: (key) => key.includes("hauler"),
    },
    {
      field: "plateNumber",
      label: "Plate No.",
      matches: (key) => key.includes("plate"),
    },
    {
      field: "actualVolume",
      label: "Actual Volume",
      matches: (key) => key.includes("volume") && !key.includes("unit"),
    },
    {
      field: "wasteType",
      label: "Waste Type",
      matches: (key) => key.includes("waste") && key.includes("type"),
    },
  ],
  hauler: [
    {
      field: "haulerName",
      label: "Hauler Name",
      matches: isHaulerNameHeader,
    },
    {
      field: "numberOfTrucks",
      label: "Number of Trucks",
      matches: isNumberOfTrucksHeader,
    },
  ],
};

const isEmptyUploadValue = (value) =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "");

const cleanUploadText = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const parseUploadNumber = (value) => {
  if (isEmptyUploadValue(value)) return null;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const normalizeUploadHeaders = (headers) =>
  headers.map(uploadHeaderKey);

const getUploadMissingColumns = (headers, type) => {
  const normalizedHeaders = normalizeUploadHeaders(headers);
  return (UPLOAD_REQUIRED_FIELDS[type] || [])
    .filter(
      (field) => !normalizedHeaders.some((header) => field.matches(header)),
    )
    .map((field) => field.label);
};

const getUploadRowErrors = (row, type) => {
  const errors = (UPLOAD_REQUIRED_FIELDS[type] || [])
    .filter((field) => isEmptyUploadValue(row[field.field]))
    .map((field) => field.label);
  const actualVolume = parseUploadNumber(row.actualVolume);
  const truckCapacity = parseUploadNumber(row.truckCapacity);
  const numberOfTrucks = parseUploadNumber(row.numberOfTrucks);
  const capacity = parseUploadNumber(row.capacity);

  if (type === "truck") {
    if (actualVolume == null || Number.isNaN(actualVolume) || actualVolume <= 0) {
      errors.push("Actual Volume must be greater than 0");
    }
    if (!isEmptyUploadValue(row.truckCapacity) && (Number.isNaN(truckCapacity) || truckCapacity <= 0)) {
      errors.push("Truck Capacity must be greater than 0");
    }
  }

  if (type === "hauler") {
    if (numberOfTrucks == null || Number.isNaN(numberOfTrucks) || numberOfTrucks <= 0) {
      errors.push("Number of Trucks must be greater than 0");
    }
    if (!isEmptyUploadValue(row.capacity) && (Number.isNaN(capacity) || capacity <= 0)) {
      errors.push("Capacity must be greater than 0");
    }
  }

  return [...new Set(errors)];
};

export default function SLFPortal() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const { showError, card: errorCard } = useErrorCard();
  const [portalUser, setPortalUser] = useState(null);
  const [activeMenu, setActiveMenu] = useState("overview");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingUser, setLoadingUser] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [entryForm] = Form.useForm();
  const [trucks, setTrucks] = useState([]);
  const [truckDraft, setTruckDraft] = useState({ ...EMPTY_TRUCK });
  const [editingTruckKey, setEditingTruckKey] = useState(null);
  const [truckErrors, setTruckErrors] = useState({});
  const [truckModalOpen, setTruckModalOpen] = useState(false);
  const [submissions, setSubmissions] = useState([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState(false);
  const [activeTab, setActiveTab] = useState("basic-info");
  const [baselineForm] = Form.useForm();
  const [companyForm] = Form.useForm();
  const [haulers, setHaulers] = useState([]);
  const [haulerDraft, setHaulerDraft] = useState({ ...EMPTY_HAULER });
  const [editingHaulerKey, setEditingHaulerKey] = useState(null);
  const [haulerErrors, setHaulerErrors] = useState({});
  const [haulerModalOpen, setHaulerModalOpen] = useState(false);
  const [baselineSaved, setBaselineSaved] = useState(false);
  const [baselineUpdatePending, setBaselineUpdatePending] = useState(false);
  const [baselineUpdateLoading, setBaselineUpdateLoading] = useState(false);
  const [baselineRefreshLoading, setBaselineRefreshLoading] = useState(false);
  const [baselineSavingLoading, setBaselineSavingLoading] = useState(false);
  const [slfInfo, setSlfInfo] = useState(null);
  const [slfInfoLoading, setSlfInfoLoading] = useState(false);
  const [slfCardExpanded, setSlfCardExpanded] = useState(false);
  const [selectedSlfIdx, setSelectedSlfIdx] = useState(0); // for multi-SLF users
  const [fieldLabels, setFieldLabels] = useState({});
  const [hazWasteCodes, setHazWasteCodes] = useState([
    "K301",
    "K302",
    "K303",
    "M501",
  ]);
  const [historyDetailModal, setHistoryDetailModal] = useState(null);
  const [revertModalOpen, setRevertModalOpen] = useState(false);
  const [revertRecord, setRevertRecord] = useState(null);
  const [revertReason, setRevertReason] = useState("");
  const [revertLoading, setRevertLoading] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  // Active cell entries (table-based)
  const [activeCellEntries, setActiveCellEntries] = useState([]);
  const [activeCellModalOpen, setActiveCellModalOpen] = useState(false);
  const [activeCellDraft, setActiveCellDraft] = useState({
    cellName: "",
    wasteType: "Residual",
    volume: null,
  });
  const [editingActiveCellKey, setEditingActiveCellKey] = useState(null);
  // Closed cell entries (table-based)
  const [closedCellEntries, setClosedCellEntries] = useState([]);
  const [closedCellModalOpen, setClosedCellModalOpen] = useState(false);
  const [closedCellDraft, setClosedCellDraft] = useState({
    cellName: "",
    wasteType: "Residual",
    volume: null,
  });
  const [editingClosedCellKey, setEditingClosedCellKey] = useState(null);
  // Hauler delete request modal
  const [haulerDeleteModal, setHaulerDeleteModal] = useState({
    open: false,
    hauler: null,
  });
  const [haulerDeleteReason, setHaulerDeleteReason] = useState("");
  const [haulerDeleteFile, setHaulerDeleteFile] = useState(null);
  const [haulerDeleteLoading, setHaulerDeleteLoading] = useState(false);
  // Hauler address dropdowns
  const [haulerProvinces, setHaulerProvinces] = useState([]);
  const [haulerCities, setHaulerCities] = useState([]);
  const [haulerBarangayList, setHaulerBarangayList] = useState([]);
  const [loadingHaulerAddress, setLoadingHaulerAddress] = useState("");
  // Hauler client modal
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [editingClientKey, setEditingClientKey] = useState(null);
  const [clientDraft, setClientDraft] = useState({
    clientName: "",
    clientType: "Private",
    region: "",
    province: "",
    municipality: "",
  });
  const [clientProvinces, setClientProvinces] = useState([]);
  const [clientMunicipalities, setClientMunicipalities] = useState([]);
  const [loadingClientAddress, setLoadingClientAddress] = useState("");
  const [extraTransportFields, setExtraTransportFields] = useState([]);
  // Address cascading dropdowns
  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [municipalities, setMunicipalities] = useState([]);
  const [barangays, setBarangays] = useState([]);
  // Global baseline unit of measurement
  const [baselineUnit, setBaselineUnit] = useState("m³");
  const [acceptsHazardousWaste, setAcceptsHazardousWaste] = useState(false);
  // Support ticket states
  const [supportDrawerOpen, setSupportDrawerOpen] = useState(false);
  const [messageDrawerOpen, setMessageDrawerOpen] = useState(false);
  const [supportTab, setSupportTab] = useState("new");
  const [supportTickets, setSupportTickets] = useState([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportDetailModal, setSupportDetailModal] = useState(null);
  const [supportReplyText, setSupportReplyText] = useState("");
  const [portalNotifications, setPortalNotifications] = useState([]);
  const [portalUnreadCount, setPortalUnreadCount] = useState(0);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [portalSettings, setPortalSettings] = useState(null);
  const [portalAnnouncement, setPortalAnnouncement] = useState(null);
  const [announcementDismissed, setAnnouncementDismissed] = useState(false);
  // Excel/CSV upload states
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadType, setUploadType] = useState("truck"); // "truck" or "hauler"
  const [uploadGuideOpen, setUploadGuideOpen] = useState(false);
  const [uploadGuideType, setUploadGuideType] = useState(null); // pending type for guide → pick
  const [uploadPreviewData, setUploadPreviewData] = useState([]);
  const [uploadPreviewColumns, setUploadPreviewColumns] = useState([]);
  const [uploadMissingColumns, setUploadMissingColumns] = useState([]);
  // My Requests / Activity Log states
  const [myRequests, setMyRequests] = useState([]);
  const [myRequestsLoading, setMyRequestsLoading] = useState(false);
  // FAQ collapsed keys
  const [faqActiveKey, setFaqActiveKey] = useState([]);
  // Profile modal
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const watchedCompanyName = Form.useWatch("lguCompanyName", companyForm);
  const watchedDisposalDate = Form.useWatch("dateOfDisposal", entryForm);
  const watchedTotalVolumeAccepted = Form.useWatch(
    "totalVolumeAccepted",
    baselineForm,
  );
  const isTreatedHazardousWaste = (value) =>
    String(value || "")
      .trim()
      .toLowerCase() === "treated hazardous waste";
  const hasHazardousWasteCode = (value) =>
    Array.isArray(value) ? value.length > 0 : !!String(value || "").trim();
  const missingHazardousCodeTrucks = trucks.filter(
    (truck) =>
      isTreatedHazardousWaste(truck.wasteType) &&
      !hasHazardousWasteCode(truck.hazWasteCode),
  );
  const missingBasicInfo = !String(watchedCompanyName || "").trim();
  const missingBaselineInfo =
    !baselineSaved &&
    (watchedTotalVolumeAccepted == null || watchedTotalVolumeAccepted === "");
  const missingDisposalInfo = !watchedDisposalDate || trucks.length === 0;
  const hasReviewMissing =
    missingBasicInfo ||
    missingBaselineInfo ||
    missingDisposalInfo ||
    missingHazardousCodeTrucks.length > 0;
  const RequiredDot = ({ show }) =>
    show ? (
      <Badge dot offset={[2, -2]} style={{ backgroundColor: "#ff4d4f" }} />
    ) : null;
  // Facility management modals (Leachate, Gas Management, Trash Slide, Fire Prevention)
  const [leachateModalOpen, setLeachateModalOpen] = useState(false);
  const [gasVentModalOpen, setGasVentModalOpen] = useState(false);
  const [trashSlideModalOpen, setTrashSlideModalOpen] = useState(false);
  const [firePrevModalOpen, setFirePrevModalOpen] = useState(false);
  const [facilityMgmtSaving, setFacilityMgmtSaving] = useState(false);
  // Local editable copies of facility detail arrays
  const [leachateDetails, setLeachateDetails] = useState([]);
  const [gasVentDetails, setGasVentDetails] = useState([]);
  const [trashSlideDetails, setTrashSlideDetails] = useState([]);
  const [firePrevDetails, setFirePrevDetails] = useState([]);
  // Waste Received modal
  const [wasteReceivedModalOpen, setWasteReceivedModalOpen] = useState(false);
  const [wasteReceivedData, setWasteReceivedData] = useState({
    lguR3: [],
    lguOutside: [],
    privateIndustry: [],
    baselineClients: [],
    submissionClients: [],
    clientBreakdown: [],
    totals: { m3: 0, tons: 0, trucks: 0 },
  });
  const [wasteReceivedLoading, setWasteReceivedLoading] = useState(false);

  const isMobile = !screens.md;

  // ── Online / offline awareness ──
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // ── Fetch portal field settings with retry ──
  const fieldsLoadedRef = useRef(false);
  const fetchFieldSettings = useCallback((signal) => {
    return withRetry(() => api.get("/settings/fields", { signal }), {
      retries: 3,
      signal,
    })
      .then(({ data }) => {
        const map = {};
        const extraTransport = [];
        data.forEach((f) => {
          map[f.fieldKey] = {
            label: f.fieldName,
            required: f.required,
            options: f.options || [],
            section: f.section,
            fieldType: f.fieldType,
          };
          if (f.section === "hazwaste-codes" && f.options?.length > 0) {
            setHazWasteCodes(f.options);
          }
          if (
            f.section === "transport-info" &&
            !KNOWN_TRANSPORT_KEYS.has(f.fieldKey) &&
            f.fieldKey !== "hazWasteCode" &&
            !f.fieldKey.toLowerCase().includes("hazwaste")
          ) {
            extraTransport.push(f);
          }
        });
        setFieldLabels(map);
        setExtraTransportFields(
          extraTransport.sort((a, b) => a.order - b.order),
        );
        fieldsLoadedRef.current = true;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetchFieldSettings(ac.signal);
    return () => ac.abort();
  }, [fetchFieldSettings]);

  // ── Fetch regions with retry ──
  const regionsLoadedRef = useRef(false);
  const fetchRegions = useCallback((signal) => {
    return withRetry(() => api.get("/settings/address/regions", { signal }), {
      retries: 3,
      signal,
    })
      .then(({ data }) => {
        setRegions(data || []);
        regionsLoadedRef.current = true;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetchRegions(ac.signal);
    return () => ac.abort();
  }, [fetchRegions]);

  // ── Auto-recover when coming back online ──
  useEffect(() => {
    if (!isOnline) return;
    // Re-fetch data that failed to load initially
    const ac = new AbortController();
    if (!fieldsLoadedRef.current) fetchFieldSettings(ac.signal);
    if (!regionsLoadedRef.current) fetchRegions(ac.signal);
    return () => ac.abort();
  }, [isOnline, fetchFieldSettings, fetchRegions]);

  const [loadingAddress, setLoadingAddress] = useState("");

  const fetchProvinces = (regionCode) => {
    setProvinces([]);
    setMunicipalities([]);
    setBarangays([]);
    companyForm.setFieldsValue({
      companyProvince: undefined,
      companyMunicipality: undefined,
      companyBarangay: undefined,
    });
    if (!regionCode) return;
    setLoadingAddress("province");
    withRetry(() => api.get(`/settings/address/provinces/${regionCode}`), {
      retries: 2,
    })
      .then(({ data }) => setProvinces(data || []))
      .catch(() =>
        showError({
          type: "error",
          title: "Load Failed",
          message: "Could not load provinces. Please re-select the region.",
        }),
      )
      .finally(() => setLoadingAddress(""));
  };

  const fetchMunicipalities = (provinceCode) => {
    setMunicipalities([]);
    setBarangays([]);
    companyForm.setFieldsValue({
      companyMunicipality: undefined,
      companyBarangay: undefined,
    });
    if (!provinceCode) return;
    setLoadingAddress("municipality");
    withRetry(
      () => api.get(`/settings/address/municipalities/${provinceCode}`),
      { retries: 2 },
    )
      .then(({ data }) => setMunicipalities(data || []))
      .catch(() =>
        showError({
          type: "error",
          title: "Load Failed",
          message:
            "Could not load municipalities. Please re-select the province.",
        }),
      )
      .finally(() => setLoadingAddress(""));
  };

  const fetchBarangays = (municipalityCode) => {
    setBarangays([]);
    companyForm.setFieldsValue({ companyBarangay: undefined });
    if (!municipalityCode) return;
    setLoadingAddress("barangay");
    withRetry(
      () => api.get(`/settings/address/barangays/${municipalityCode}`),
      { retries: 2 },
    )
      .then(({ data }) => setBarangays(data || []))
      .catch(() =>
        showError({
          type: "error",
          title: "Load Failed",
          message:
            "Could not load barangays. Please re-select the municipality.",
        }),
      )
      .finally(() => setLoadingAddress(""));
  };

  // ── Hauler address fetch helpers ──
  // Helper to update multiple address fields in haulerDraft at once
  const updateHaulerDraftAddr = (fields) => {
    setHaulerDraft((prev) => ({ ...prev, ...fields }));
  };
  const fetchHaulerProvinces = (regionCode) => {
    setHaulerProvinces([]);
    setHaulerCities([]);
    setHaulerBarangayList([]);
    updateHaulerDraftAddr({
      officeProvince: "",
      officeCity: "",
      officeBarangay: "",
    });
    if (!regionCode) return;
    setLoadingHaulerAddress("province");
    withRetry(() => api.get(`/settings/address/provinces/${regionCode}`), {
      retries: 2,
    })
      .then(({ data }) => setHaulerProvinces(data || []))
      .catch(() =>
        showError({
          type: "error",
          title: "Load Failed",
          message: "Could not load provinces.",
        }),
      )
      .finally(() => setLoadingHaulerAddress(""));
  };
  const fetchHaulerCities = (provinceCode) => {
    setHaulerCities([]);
    setHaulerBarangayList([]);
    updateHaulerDraftAddr({ officeCity: "", officeBarangay: "" });
    if (!provinceCode) return;
    setLoadingHaulerAddress("city");
    withRetry(
      () => api.get(`/settings/address/municipalities/${provinceCode}`),
      { retries: 2 },
    )
      .then(({ data }) => setHaulerCities(data || []))
      .catch(() =>
        showError({
          type: "error",
          title: "Load Failed",
          message: "Could not load cities/municipalities.",
        }),
      )
      .finally(() => setLoadingHaulerAddress(""));
  };
  const fetchHaulerBarangays = (cityCode) => {
    setHaulerBarangayList([]);
    updateHaulerDraftAddr({ officeBarangay: "" });
    if (!cityCode) return;
    setLoadingHaulerAddress("barangay");
    withRetry(() => api.get(`/settings/address/barangays/${cityCode}`), {
      retries: 2,
    })
      .then(({ data }) => setHaulerBarangayList(data || []))
      .catch(() =>
        showError({
          type: "error",
          title: "Load Failed",
          message: "Could not load barangays.",
        }),
      )
      .finally(() => setLoadingHaulerAddress(""));
  };
  // Helper to get field label from settings, fallback to default
  const fl = (key, fallback) => fieldLabels[key]?.label || fallback;
  // Helper: is field required per admin settings? Falls back to defaultReq.
  const isRequired = (key, defaultReq = false) =>
    fieldLabels[key] ? fieldLabels[key].required : defaultReq;
  // Helper: get select options from settings, with fallback
  const opts = (key, fallback = []) =>
    fieldLabels[key]?.options?.length > 0 ? fieldLabels[key].options : fallback;

  const isAnnouncementActive = (settings) => {
    const now = Date.now();
    const startsAt = settings?.portalAnnouncementStartAt
      ? new Date(settings.portalAnnouncementStartAt).getTime()
      : null;
    const endsAt = settings?.portalAnnouncementEndAt
      ? new Date(settings.portalAnnouncementEndAt).getTime()
      : null;
    return (
      settings?.portalAnnouncementEnabled &&
      settings?.portalAnnouncementShowInPortal !== false &&
      (!startsAt || startsAt <= now) &&
      (!endsAt || endsAt >= now)
    );
  };

  useEffect(() => {
    fetchWithCache(
      PORTAL_SETTINGS_CACHE_KEY,
      () => api.get("/settings/app").then(({ data }) => data),
      {
        ttl: PORTAL_CACHE_TTL,
        onData: (data) => {
        setPortalSettings(data);
        setPortalAnnouncement(isAnnouncementActive(data) ? data : null);
        },
      },
    ).catch(() => {});
  }, []);

  useEffect(() => {
    if (!portalAnnouncement || !portalUser) return;
    const key = `portal-announcement-seen-${portalAnnouncement.updatedAt || portalAnnouncement._id || portalAnnouncement.portalAnnouncementTitle}`;
    if (sessionStorage.getItem(key) === "1") return;
    sessionStorage.setItem(key, "1");
    Modal.info({
      title:
        portalAnnouncement.portalAnnouncementTitle || "SLF Portal Announcement",
      content: (
        <div style={{ whiteSpace: "pre-wrap" }}>
          {portalAnnouncement.portalAnnouncementMessage}
        </div>
      ),
      okText: "Got it",
      width: 560,
    });
  }, [portalAnnouncement, portalUser]);

  // Load portal user from storage, then refresh from server for latest status/isVerified
  useEffect(() => {
    const token = secureStorage.get("portal_token");
    const user = secureStorage.getJSON("portal_user");
    if (!token || !user) {
      navigate("/slfportal/login");
      return;
    }
    if (user.verificationRequired) {
      navigate("/slfportal/verify-update", { replace: true });
      return;
    }
    setPortalUser(user);
    setLoadingUser(false);

    // Refresh user data from server to pick up latest status & isVerified
    api
      .get("/portal-auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => {
        const refreshed = {
          ...user,
          username: data.username,
          email: data.email,
          status: data.status,
          isVerified: data.isVerified,
          verificationRequired: data.verificationRequired,
          verificationSubmitted: data.verificationSubmitted,
        };
        secureStorage.setJSON("portal_user", refreshed);
        if (data.verificationRequired) {
          navigate("/slfportal/verify-update", { replace: true });
          return;
        }
        setPortalUser(refreshed);
      })
      .catch(() => {});

    // Connect socket for real-time notifications
    const sock = connectSocket("portal", user.email);
    return () => {
      disconnectSocket();
    };
  }, [navigate]);

  const getNotifIcon = (type) => {
    if (type === "reverted")
      return <UndoOutlined style={{ color: "#fa541c" }} />;
    if (type === "status_change")
      return <CheckCircleOutlined style={{ color: "#52c41a" }} />;
    return <BellOutlined style={{ color: "#1a3353" }} />;
  };

  // Fetch SLF facility operational info
  const activeSlfId = Array.isArray(portalUser?.assignedSlf)
    ? portalUser.assignedSlf[selectedSlfIdx] || portalUser.assignedSlf[0]
    : portalUser?.assignedSlf;
  const activeSlfName = Array.isArray(portalUser?.assignedSlfName)
    ? portalUser.assignedSlfName[selectedSlfIdx] ||
      portalUser.assignedSlfName[0]
    : portalUser?.assignedSlfName;
  const activeCellOptions = (() => {
    const count = Number(
      slfInfo?.numberOfCell || slfInfo?.cellStatuses?.length || 0,
    );
    return Array.from({ length: count }, (_, index) => {
      const status = normalizeCellStatus(slfInfo?.cellStatuses?.[index]);
      const isOpen = isActiveCellStatus(status);
      return isOpen
        ? {
            label: `Cell ${index + 1}${slfInfo?.cellTypes?.[index] ? ` - ${slfInfo.cellTypes[index]}` : ""}`,
            value: `Cell ${index + 1}`,
          }
        : null;
    }).filter(Boolean);
  })();

  useEffect(() => {
    if (!activeSlfId) return;
    const ac = new AbortController();
    setSlfInfoLoading(true);
    const nameParam = activeSlfName
      ? `?slfName=${encodeURIComponent(activeSlfName)}`
      : "";
    withRetry(
      () =>
        api.get(`/slf-facilities/portal/${activeSlfId}${nameParam}`, {
          signal: ac.signal,
        }),
      { retries: 3, signal: ac.signal },
    )
      .then(({ data }) => {
        setSlfInfo(data);
        setLeachateDetails(
          (data.leachatePondDetails || []).map((p, i) => ({ ...p, _key: i })),
        );
        setGasVentDetails(
          (data.gasVentDetails || []).map((v, i) => ({ ...v, _key: i })),
        );
        setTrashSlideDetails(
          (data.trashSlideMeasures || []).map((m, i) => ({ ...m, _key: i })),
        );
        setFirePrevDetails(
          (data.firePrevMeasures || []).map((m, i) => ({ ...m, _key: i })),
        );
      })
      .catch(() => {})
      .finally(() => setSlfInfoLoading(false));
    return () => ac.abort();
  }, [portalUser, selectedSlfIdx]);

  // Fetch existing baseline when user is loaded (with retry)
  useEffect(() => {
    if (!activeSlfName) return;
    const ac = new AbortController();
    withRetry(
      () =>
        api.get(`/data-slf/baseline/${encodeURIComponent(activeSlfName)}`, {
          signal: ac.signal,
        }),
      { retries: 3, signal: ac.signal },
    )
      .then(({ data }) => {
        if (hasBaselinePayload(data)) {
          const unit =
            data.baselineUnit || data.totalVolumeAcceptedUnit || "m³";
          setBaselineUnit(unit);
          setAcceptsHazardousWaste(data.acceptsHazardousWaste || false);
          baselineForm.setFieldsValue({
            baselineUnit: unit,
            totalVolumeAccepted: data.totalVolumeAccepted,
            totalVolumeAcceptedUnit: data.totalVolumeAcceptedUnit || unit,
            activeCellResidualVolume: data.activeCellResidualVolume,
            activeCellResidualUnit: data.activeCellResidualUnit || unit,
            activeCellInertVolume: data.activeCellInertVolume,
            activeCellInertUnit: data.activeCellInertUnit || unit,
            activeCellHazardousVolume: data.activeCellHazardousVolume,
            activeCellHazardousUnit: data.activeCellHazardousUnit || unit,
            closedCellResidualVolume: data.closedCellResidualVolume,
            closedCellResidualUnit: data.closedCellResidualUnit || unit,
            closedCellInertVolume: data.closedCellInertVolume,
            closedCellInertUnit: data.closedCellInertUnit || unit,
            closedCellHazardousVolume: data.closedCellHazardousVolume,
            closedCellHazardousUnit: data.closedCellHazardousUnit || unit,
            acceptsHazardousWaste: data.acceptsHazardousWaste || false,
          });
          const savedCompanyValues = {
            lguCompanyName:
              data.lguCompanyName ||
              companyForm.getFieldValue("lguCompanyName") ||
              "",
            companyRegion: data.companyRegion,
            companyProvince: data.companyProvince,
            companyMunicipality: data.companyMunicipality,
            companyBarangay: data.companyBarangay,
          };
          companyForm.setFieldsValue(savedCompanyValues);
          entryForm.setFieldsValue({
            lguCompanyName: savedCompanyValues.lguCompanyName,
            companyType:
              data.companyType ||
              ((slfInfo?.ownership || "").toLowerCase().includes("private")
                ? "Private"
                : "LGU"),
            address: data.address || entryForm.getFieldValue("address"),
          });
          if (data.companyRegion) {
            withRetry(
              () =>
                api.get(`/settings/address/provinces/${data.companyRegion}`, {
                  signal: ac.signal,
                }),
              { retries: 2, signal: ac.signal },
            )
              .then(({ data: provinceData }) =>
                setProvinces(provinceData || []),
              )
              .then(() => companyForm.setFieldsValue(savedCompanyValues))
              .catch(() => {});
          }
          if (data.companyProvince) {
            withRetry(
              () =>
                api.get(
                  `/settings/address/municipalities/${data.companyProvince}`,
                  { signal: ac.signal },
                ),
              { retries: 2, signal: ac.signal },
            )
              .then(({ data: municipalityData }) =>
                setMunicipalities(municipalityData || []),
              )
              .then(() => companyForm.setFieldsValue(savedCompanyValues))
              .catch(() => {});
          }
          if (data.companyMunicipality) {
            withRetry(
              () =>
                api.get(
                  `/settings/address/barangays/${data.companyMunicipality}`,
                  {
                    signal: ac.signal,
                  },
                ),
              { retries: 2, signal: ac.signal },
            )
              .then(({ data: barangayData }) =>
                setBarangays(barangayData || []),
              )
              .then(() => companyForm.setFieldsValue(savedCompanyValues))
              .catch(() => {});
          }
          setHaulers(mergeHaulersByName(data.accreditedHaulers || [], unit));
          // Load activeCellEntries from saved data (or migrate from flat fields)
          if (data.activeCellEntries?.length) {
            setActiveCellEntries(
              data.activeCellEntries.map((e, i) => ({
                ...e,
                unit: e.unit || unit,
                key: i,
              })),
            );
          } else {
            const entries = [];
            let k = 1;
            if (data.activeCellResidualVolume)
              entries.push({
                key: k++,
                cellName: "",
                wasteType: "Residual",
                volume: data.activeCellResidualVolume,
                unit: data.activeCellResidualUnit || unit,
              });
            if (data.activeCellInertVolume)
              entries.push({
                key: k++,
                cellName: "",
                wasteType: "Inert/Hazardous Waste",
                volume: data.activeCellInertVolume,
                unit: data.activeCellInertUnit || unit,
              });
            if (data.activeCellHazardousVolume)
              entries.push({
                key: k++,
                cellName: "",
                wasteType: "Inert/Hazardous Waste",
                volume: data.activeCellHazardousVolume,
                unit: data.activeCellHazardousUnit || unit,
              });
            setActiveCellEntries(entries);
          }
          // Load closedCellEntries from saved data (or migrate from flat fields)
          if (data.closedCellEntries?.length) {
            setClosedCellEntries(
              data.closedCellEntries.map((e, i) => ({
                ...e,
                unit: e.unit || unit,
                key: i,
              })),
            );
          } else {
            const cEntries = [];
            let ck = 1;
            if (data.closedCellResidualVolume)
              cEntries.push({
                key: ck++,
                cellName: "",
                wasteType: "Residual",
                volume: data.closedCellResidualVolume,
                unit: data.closedCellResidualUnit || unit,
              });
            if (data.closedCellInertVolume)
              cEntries.push({
                key: ck++,
                cellName: "",
                wasteType: "Inert/Hazardous Waste",
                volume: data.closedCellInertVolume,
                unit: data.closedCellInertUnit || unit,
              });
            if (data.closedCellHazardousVolume)
              cEntries.push({
                key: ck++,
                cellName: "",
                wasteType: "Inert/Hazardous Waste",
                volume: data.closedCellHazardousVolume,
                unit: data.closedCellHazardousUnit || unit,
              });
            setClosedCellEntries(cEntries);
          }
          setBaselineSaved(true);
          setBaselineUpdatePending(!!data.baselineUpdateRequested);
          // If baseline update was approved, allow editing
          if (data.baselineUpdateApproved) {
            setBaselineSaved(false);
            setBaselineUpdatePending(false);
          }
          setActiveTab("disposal");
        } else {
          setBaselineSaved(false);
          setBaselineUpdatePending(false);
          setHaulers([]);
          setActiveCellEntries([]);
          setClosedCellEntries([]);
        }
      })
      .catch(() => {});
    return () => ac.abort();
  }, [portalUser, selectedSlfIdx]);

  // Re-fetch baseline when admin approves/rejects
  useEffect(() => {
    if (!portalUser?.email || !activeSlfName) return;
    const sock = connectSocket("portal", portalUser.email);
    const handler = (payload) => {
      if (
        payload?.type === "baseline_update_approved" ||
        payload?.type === "baseline_update_rejected" ||
        payload?.type === "baseline_locked"
      ) {
        api
          .get(`/data-slf/baseline/${encodeURIComponent(activeSlfName)}`)
          .then(({ data }) => {
            if (hasBaselinePayload(data)) {
              if (data.baselineUpdateApproved) {
                setBaselineSaved(false);
                setBaselineUpdatePending(false);
              } else {
                setBaselineSaved(true);
                setBaselineUpdatePending(!!data.baselineUpdateRequested);
              }
            }
          })
          .catch(() => {});
      }
    };
    sock.on("notification", handler);
    return () => {
      sock.off("notification", handler);
    };
  }, [portalUser, activeSlfName]);

  // Fetch submission history
  const pollingRef = useRef(null);
  const fetchingRef = useRef(false);

  const fetchSubmissions = useCallback(async (silent = false) => {
    if (fetchingRef.current) return; // deduplicate concurrent requests
    fetchingRef.current = true;
    if (!silent) setLoadingSubmissions(true);
    try {
      await fetchWithCache(
        `${PORTAL_SUBMISSIONS_CACHE_KEY}-${portalUser?.email || ""}`,
        () => api.get("/portal-auth/my-submissions", {
          headers: {
            Authorization: `Bearer ${secureStorage.get("portal_token")}`,
          },
        }).then(({ data }) => data),
        {
          ttl: PORTAL_CACHE_TTL,
          force: false,
          onData: (data) => setSubmissions(Array.isArray(data) ? data : []),
        },
      );
    } catch {
      // silent
    } finally {
      fetchingRef.current = false;
      if (!silent) setLoadingSubmissions(false);
    }
  }, [portalUser?.email]);

  useEffect(() => {
    if ((activeMenu === "history" || activeMenu === "overview") && portalUser) {
      fetchSubmissions();
      // Real-time refresh via socket + fallback 60s polling
      const sock = connectSocket("portal", portalUser.email);
      const handler = () => {
        invalidateCache(`${PORTAL_SUBMISSIONS_CACHE_KEY}-${portalUser?.email || ""}`);
        invalidateCache(`${PORTAL_WASTE_RECEIVED_CACHE_KEY}:${activeSlfId || activeSlfName}`);
        fetchSubmissions(true);
      };
      sock.on("notification", handler);
      sock.on("data-refresh", handler);
      pollingRef.current = setInterval(() => {
        if (navigator.onLine) fetchSubmissions(true);
      }, 60000);
      return () => {
        sock.off("notification", handler);
        sock.off("data-refresh", handler);
        if (pollingRef.current) clearInterval(pollingRef.current);
      };
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [activeMenu, activeSlfId, activeSlfName, portalUser, fetchSubmissions]);

  // When coming back online while on history tab, refresh immediately
  useEffect(() => {
    if (isOnline && (activeMenu === "history" || activeMenu === "overview") && portalUser) {
      fetchSubmissions(true);
    }
  }, [isOnline, activeMenu, portalUser, fetchSubmissions]);

  // ── My Requests fetch ──
  const fetchMyRequests = useCallback(async () => {
    if (!portalUser?.email) return;
    setMyRequestsLoading(true);
    try {
      const { data } = await api.get("/transactions", {
        params: {
          search: portalUser.email,
          type: "",
          limit: 100,
        },
      });
      // Filter to request/amendment types from this user
      const requestTypes = new Set([
        "baseline_update_request",
        "baseline_update_approved",
        "submission_edit_request",
        "submission_edit_approved",
        "submission_edit_rejected",
        "support_ticket",
        "support_ticket_reply",
      ]);
      const filtered = (data.transactions || []).filter(
        (t) =>
          requestTypes.has(t.type) &&
          !/^admin (started|replied to) conversation\b/i.test(
            t.description || "",
          ) &&
          (t.submittedBy === portalUser.email ||
            t.performedBy === portalUser.email),
      );
      setMyRequests(filtered);
    } catch {
      /* silent */
    } finally {
      setMyRequestsLoading(false);
    }
  }, [portalUser]);

  useEffect(() => {
    if (activeMenu === "requests" && portalUser) {
      fetchMyRequests();
      const sock = connectSocket("portal", portalUser.email);
      const handler = () => fetchMyRequests();
      sock.on("notification", handler);
      sock.on("data-refresh", handler);
      return () => {
        sock.off("notification", handler);
        sock.off("data-refresh", handler);
      };
    }
  }, [activeMenu, portalUser, fetchMyRequests]);

  const handleLogout = () => {
    secureStorage.clearAll();
    navigate("/slfportal/login");
  };

  // ── Truck helpers (no <Form>, just state) ──

  const updateTruckDraft = (field, value) => {
    setTruckDraft((prev) => ({ ...prev, [field]: value }));
    if (truckErrors[field]) {
      setTruckErrors((prev) => {
        const copy = { ...prev };
        delete copy[field];
        return copy;
      });
    }
  };

  const validateTruck = () => {
    const errs = {};
    if (!truckDraft.disposalTicketNo?.trim())
      errs.disposalTicketNo = "Required";
    if (isRequired("hauler", true) && !truckDraft.hauler?.trim())
      errs.hauler = "Required";
    if (
      isRequired("plateNumber", true) &&
      !(truckDraft.vehicles || []).some((v) => v.plateNumber?.trim())
    )
      errs.plateNumber = "At least one vehicle plate number is required";
    if (
      isRequired("actualVolume", true) &&
      !truckDraft.actualVolume &&
      truckDraft.actualVolume !== 0
    )
      errs.actualVolume = "Required";
    if (isRequired("wasteType", true) && !truckDraft.wasteType)
      errs.wasteType = "Required";
    if (
      isTreatedHazardousWaste(truckDraft.wasteType) &&
      !hasHazardousWasteCode(truckDraft.hazWasteCode)
    ) {
      errs.hazWasteCode = "Required for Treated Hazardous Waste";
    }
    // Validate additional transport fields from Portal Field Settings
    extraTransportFields.forEach((f) => {
      if (f.required) {
        const val = truckDraft[f.fieldKey];
        if (val === undefined || val === null || val === "") {
          errs[f.fieldKey] = "Required";
        }
      }
    });
    setTruckErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleAddTruck = () => {
    if (!validateTruck()) return;
    if (editingTruckKey) {
      setTrucks((prev) =>
        prev.map((t) =>
          t.key === editingTruckKey ? { ...t, ...truckDraft } : t,
        ),
      );
      setEditingTruckKey(null);
    } else {
      setTrucks((prev) => [...prev, { key: Date.now(), ...truckDraft }]);
    }
    setTruckDraft({ ...EMPTY_TRUCK });
    setTruckErrors({});
  };

  const removeTruck = (key) => {
    setTrucks((prev) => prev.filter((t) => t.key !== key));
  };

  // ── Hauler helpers ──

  const updateHaulerDraft = (field, value) => {
    setHaulerDraft((prev) => {
      const next = { ...prev, [field]: value };
      // When numberOfTrucks changes, resize vehicles array
      if (field === "numberOfTrucks") {
        const count = Math.max(0, Math.min(value || 0, 50));
        const current = prev.vehicles || [];
        const vehicles = [];
        for (let i = 0; i < count; i++) {
          vehicles.push(current[i] || { ...EMPTY_VEHICLE });
        }
        next.vehicles = vehicles;
      }
      return next;
    });
    if (haulerErrors[field]) {
      setHaulerErrors((prev) => {
        const c = { ...prev };
        delete c[field];
        return c;
      });
    }
  };

  const updateVehicle = (index, field, value) => {
    setHaulerDraft((prev) => {
      const vehicles = [...(prev.vehicles || [])];
      vehicles[index] = { ...vehicles[index], [field]: value };
      return { ...prev, vehicles };
    });
  };

  const validateHauler = () => {
    const errs = {};
    if (!haulerDraft.haulerName?.trim()) errs.haulerName = "Required";
    if (!haulerDraft.numberOfTrucks && haulerDraft.numberOfTrucks !== 0)
      errs.numberOfTrucks = "Required";
    setHaulerErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const openHaulerModal = (record) => {
    setHaulerProvinces([]);
    setHaulerCities([]);
    setHaulerBarangayList([]);
    if (record) {
      setEditingHaulerKey(record.key);
      // Migrate legacy single-vehicle data to vehicles array
      let vehicles = Array.isArray(record.vehicles) ? [...record.vehicles] : [];
      if (
        vehicles.length === 0 &&
        (record.plateNumber || record.vehicleType || record.capacity != null)
      ) {
        vehicles = [
          {
            plateNumber: record.plateNumber || "",
            vehicleType: record.vehicleType || "",
            capacity: record.capacity,
            capacityUnit: record.capacityUnit || "m³",
          },
        ];
      }
      const count = record.numberOfTrucks || vehicles.length || 0;
      // Ensure vehicles array matches numberOfTrucks
      while (vehicles.length < count) vehicles.push({ ...EMPTY_VEHICLE });
      if (vehicles.length > count && count > 0)
        vehicles = vehicles.slice(0, count);
      setHaulerDraft({
        haulerName: record.haulerName || "",
        numberOfTrucks: count || null,
        officeAddress: record.officeAddress || "",
        officeRegion: record.officeRegion || "",
        officeProvince: record.officeProvince || "",
        officeCity: record.officeCity || "",
        officeBarangay: record.officeBarangay || "",
        vehicles,
        privateSectorClients: Array.isArray(record.privateSectorClients)
          ? record.privateSectorClients
          : record.privateSectorClients
            ? [record.privateSectorClients]
            : [],
      });
      // Pre-load cascading address lists
      if (record.officeRegion) {
        withRetry(
          () => api.get(`/settings/address/provinces/${record.officeRegion}`),
          { retries: 2 },
        )
          .then(({ data }) => {
            setHaulerProvinces(data || []);
            if (record.officeProvince) {
              withRetry(
                () =>
                  api.get(
                    `/settings/address/municipalities/${record.officeProvince}`,
                  ),
                { retries: 2 },
              )
                .then(({ data: d2 }) => {
                  setHaulerCities(d2 || []);
                  if (record.officeCity) {
                    withRetry(
                      () =>
                        api.get(
                          `/settings/address/barangays/${record.officeCity}`,
                        ),
                      { retries: 2 },
                    )
                      .then(({ data: d3 }) => setHaulerBarangayList(d3 || []))
                      .catch(() => {});
                  }
                })
                .catch(() => {});
            }
          })
          .catch(() => {});
      }
    } else {
      setEditingHaulerKey(null);
      setHaulerDraft({ ...EMPTY_HAULER });
    }
    setHaulerErrors({});
    setHaulerModalOpen(true);
  };

  const handleSaveHauler = () => {
    if (!validateHauler()) return;
    // Build a human-readable officeAddress from selected codes
    const regionName =
      regions.find((r) => r.code === haulerDraft.officeRegion)?.name ||
      haulerDraft.officeRegion ||
      "";
    const provinceName =
      haulerProvinces.find((p) => p.code === haulerDraft.officeProvince)
        ?.name ||
      haulerDraft.officeProvince ||
      "";
    const cityName =
      haulerCities.find((c) => c.code === haulerDraft.officeCity)?.name ||
      haulerDraft.officeCity ||
      "";
    const barangayName =
      haulerBarangayList.find((b) => b.code === haulerDraft.officeBarangay)
        ?.name ||
      haulerDraft.officeBarangay ||
      "";
    const addressParts = [
      barangayName,
      cityName,
      provinceName,
      regionName,
    ].filter(Boolean);
    const resolvedAddress = addressParts.join(", ");
    const finalDraft = normalizeHaulerRecord(
      { ...haulerDraft, officeAddress: resolvedAddress },
      0,
      baselineUnit || "m³",
    );
    if (editingHaulerKey) {
      setHaulers((prev) =>
        mergeHaulersByName(
          prev.map((h) =>
            h.key === editingHaulerKey ? { ...h, ...finalDraft } : h,
          ),
          baselineUnit || "m³",
        ),
      );
    } else {
      setHaulers((prev) =>
        mergeHaulersByName(
          [...prev, { key: Date.now(), ...finalDraft }],
          baselineUnit || "m³",
        ),
      );
    }
    setHaulerModalOpen(false);
    setEditingHaulerKey(null);
    setHaulerDraft({ ...EMPTY_HAULER });
    setHaulerErrors({});
  };

  const removeHauler = (key) => {
    setHaulers((prev) => prev.filter((h) => h.key !== key));
  };

  // ── Truck modal helpers ──

  const openTruckModal = (record) => {
    if (record) {
      setEditingTruckKey(record.key);
      const draft = {
        disposalTicketNo: record.disposalTicketNo || "",
        hauler: record.hauler || "",
        plateNumber: record.plateNumber || "",
        truckCapacity: record.truckCapacity,
        truckCapacityUnit: record.truckCapacityUnit || baselineUnit || "m³",
        vehicles:
          record.vehicles?.length > 0
            ? record.vehicles.map((v, i) => ({ ...v, key: Date.now() + i }))
            : record.plateNumber
              ? [
                  {
                    key: Date.now(),
                    plateNumber: record.plateNumber,
                    capacity: record.truckCapacity,
                    capacityUnit:
                      record.truckCapacityUnit || baselineUnit || "m³",
                  },
                ]
              : [
                  {
                    ...EMPTY_VEHICLE,
                    key: Date.now(),
                    capacityUnit: baselineUnit || "m³",
                  },
                ],
        actualVolume: record.actualVolume,
        actualVolumeUnit: record.actualVolumeUnit || baselineUnit || "m³",
        wasteType: record.wasteType,
        hazWasteCode: record.hazWasteCode,
      };
      // Populate additional transport fields from record
      extraTransportFields.forEach((f) => {
        draft[f.fieldKey] =
          record[f.fieldKey] ?? (f.fieldType === "number" ? null : "");
      });
      setTruckDraft(draft);
    } else {
      setEditingTruckKey(null);
      const draft = {
        ...EMPTY_TRUCK,
        truckCapacityUnit: baselineUnit || "m³",
        actualVolumeUnit: baselineUnit || "m³",
        vehicles: [
          {
            ...EMPTY_VEHICLE,
            key: Date.now(),
            capacityUnit: baselineUnit || "m³",
          },
        ],
      };
      // Initialize additional transport fields with defaults
      extraTransportFields.forEach((f) => {
        draft[f.fieldKey] = f.fieldType === "number" ? null : "";
      });
      setTruckDraft(draft);
    }
    setTruckErrors({});
    setTruckModalOpen(true);
  };

  // ── Active Cell Entry helpers ──
  const handleSaveActiveCellEntry = () => {
    if (
      !activeCellDraft.cellName ||
      !activeCellDraft.wasteType ||
      activeCellDraft.volume == null
    ) {
      return;
    }
    if (editingActiveCellKey != null) {
      setActiveCellEntries((prev) =>
        prev.map((e) =>
          e.key === editingActiveCellKey
            ? {
                ...activeCellDraft,
                unit: normalizeUnit(
                  activeCellDraft.unit || baselineUnit || "m³",
                ),
                key: editingActiveCellKey,
              }
            : e,
        ),
      );
    } else {
      setActiveCellEntries((prev) => [
        ...prev,
        {
          ...activeCellDraft,
          unit: normalizeUnit(activeCellDraft.unit || baselineUnit || "m³"),
          key: Date.now(),
        },
      ]);
    }
    setActiveCellModalOpen(false);
  };

  // ── Closed Cell Entry helpers ──
  const handleSaveClosedCellEntry = () => {
    if (
      !closedCellDraft.cellName ||
      !closedCellDraft.wasteType ||
      closedCellDraft.volume == null
    ) {
      return;
    }
    if (editingClosedCellKey != null) {
      setClosedCellEntries((prev) =>
        prev.map((e) =>
          e.key === editingClosedCellKey
            ? {
                ...closedCellDraft,
                unit: normalizeUnit(
                  closedCellDraft.unit || baselineUnit || "m³",
                ),
                key: editingClosedCellKey,
              }
            : e,
        ),
      );
    } else {
      setClosedCellEntries((prev) => [
        ...prev,
        {
          ...closedCellDraft,
          unit: normalizeUnit(closedCellDraft.unit || baselineUnit || "m³"),
          key: Date.now(),
        },
      ]);
    }
    setClosedCellModalOpen(false);
  };

  // ── Hauler Client helpers ──
  const handleSaveClient = () => {
    if (!clientDraft.clientName || !clientDraft.clientType) return;
    // Resolve PSGC codes to human-readable names for LGU type
    const regionName =
      (regions || []).find((r) => String(r.code) === clientDraft.region)
        ?.name || "";
    const provinceName =
      (clientProvinces || []).find(
        (p) => String(p.code) === clientDraft.province,
      )?.name || "";
    const municipalityName =
      (clientMunicipalities || []).find(
        (m) => String(m.code) === clientDraft.municipality,
      )?.name || "";
    const toSave = {
      ...clientDraft,
      regionName,
      provinceName,
      municipalityName,
    };
    const existing = haulerDraft.privateSectorClients || [];
    if (editingClientKey != null) {
      updateHaulerDraft(
        "privateSectorClients",
        existing.map((c) =>
          c.key === editingClientKey ? { ...toSave, key: editingClientKey } : c,
        ),
      );
    } else {
      updateHaulerDraft("privateSectorClients", [
        ...existing,
        { ...toSave, key: Date.now() },
      ]);
    }
    setClientModalOpen(false);
  };

  const handleSaveTruck = () => {
    if (!validateTruck()) return;
    // Flatten first vehicle into top-level fields for backward compat
    const vehicles = (truckDraft.vehicles || []).map(
      ({ key, ...rest }) => rest,
    );
    const first = vehicles[0] || {};
    const savedDraft = {
      ...truckDraft,
      plateNumber: first.plateNumber || truckDraft.plateNumber || "",
      truckCapacity: first.capacity ?? truckDraft.truckCapacity,
      truckCapacityUnit: first.capacityUnit || truckDraft.truckCapacityUnit,
      vehicles,
    };
    if (editingTruckKey) {
      setTrucks((prev) =>
        prev.map((t) =>
          t.key === editingTruckKey ? { ...t, ...savedDraft } : t,
        ),
      );
    } else {
      setTrucks((prev) => [...prev, { key: Date.now(), ...savedDraft }]);
    }
    setTruckModalOpen(false);
    setEditingTruckKey(null);
    setTruckDraft({ ...EMPTY_TRUCK });
    setTruckErrors({});
  };

  // ── Revert request helpers ──

  const openRevertModal = (record) => {
    setRevertRecord(record);
    setRevertReason("");
    setRevertModalOpen(true);
  };

  const handleRequestRevert = async () => {
    if (!revertReason.trim()) return;
    if (!navigator.onLine) {
      showError({
        type: "offline",
        title: "You\u2019re Offline",
        message: "Please check your internet connection and try again.",
      });
      return;
    }
    setRevertLoading(true);
    try {
      await api.patch(`/data-slf/${revertRecord._id}/request-edit`, {
        reason: revertReason,
        requestedBy: portalUser?.email,
      });
      setRevertModalOpen(false);
      setRevertRecord(null);
      setRevertReason("");
      fetchSubmissions();
      Swal.fire({
        icon: "success",
        title: "Edit Requested",
        html: "Your edit request has been sent. The admin will review and approve or reject it.",
        confirmButtonColor: "#1a3353",
      });
    } catch (err) {
      if (!navigator.onLine || err.code === "ERR_NETWORK") {
        showError({
          type: "offline",
          title: "Connection Lost",
          message: "Please check your internet connection and try again.",
        });
      } else {
        showError({
          type: "error",
          title: "Request Failed",
          message: err.response?.data?.message || "Something went wrong.",
        });
      }
    } finally {
      setRevertLoading(false);
    }
  };

  // ── Request Baseline Update ──
  const handleBaselineUpdateRequest = async () => {
    const { value: reason } = await Swal.fire({
      title: "Request Baseline Update",
      html: "<p style='font-size:13px'>Your baseline data is locked after your first submission. Provide a reason and the admin will review your request.</p>",
      input: "textarea",
      inputPlaceholder: "Describe what needs to be updated and why...",
      inputAttributes: { "aria-label": "Reason" },
      showCancelButton: true,
      confirmButtonText: "Send Request",
      confirmButtonColor: "#1a3353",
      inputValidator: (v) => {
        if (!v?.trim()) return "Please provide a reason";
      },
    });
    if (!reason) return;
    setBaselineUpdateLoading(true);
    try {
      await api.post("/data-slf/baseline-update-request", {
        slfName: activeSlfName,
        requestedBy: portalUser?.email,
        fields: [
          "Volume of Waste Accepted",
          "Total Volume Disposed in Active Cells",
          "Accredited Haulers",
          "Total Volume Disposed in Closed Cells",
        ],
        reason: reason.trim(),
      });
      Swal.fire({
        icon: "success",
        title: "Request Sent",
        text: "Your baseline update request has been sent to the admin for review.",
        confirmButtonColor: "#1a3353",
      });
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Failed",
        text: err.response?.data?.message || "Could not send request.",
      });
    } finally {
      setBaselineUpdateLoading(false);
    }
  };

  const refreshBaselineStatus = async () => {
    if (!activeSlfName) return;
    setBaselineRefreshLoading(true);
    try {
      const { data } = await api.get(
        `/data-slf/baseline/${encodeURIComponent(activeSlfName)}`,
      );
      if (hasBaselinePayload(data)) {
        if (data.baselineUpdateApproved) {
          setBaselineSaved(false);
          setBaselineUpdatePending(false);
          Swal.fire({
            icon: "success",
            title: "Baseline Editing Unlocked",
            timer: 1400,
            showConfirmButton: false,
          });
        } else {
          setBaselineSaved(true);
          setBaselineUpdatePending(!!data.baselineUpdateRequested);
          Swal.fire({
            icon: "info",
            title: data.baselineUpdateRequested
              ? "Still Awaiting Approval"
              : "Baseline Still Locked",
            timer: 1400,
            showConfirmButton: false,
          });
        }
      }
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Refresh Failed",
        text:
          err.response?.data?.message || "Could not refresh baseline status.",
      });
    } finally {
      setBaselineRefreshLoading(false);
    }
  };

  // ── Save Portal Baseline Update (after admin approval) ──
  const handleSaveBaselinePortal = async () => {
    const confirm = await Swal.fire({
      title: "Save Baseline Update?",
      html: "<p style='font-size:13px'>This will save your updated baseline data and re-lock the baseline for future edits. You will need to submit another update request if further changes are needed.</p>",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Save & Lock",
      confirmButtonColor: "#1a3353",
      cancelButtonText: "Continue Editing",
    });
    if (!confirm.isConfirmed) return;

    setBaselineSavingLoading(true);
    try {
      const [baselineValues, companyValues] = await Promise.all([
        baselineForm.validateFields(),
        companyForm.validateFields(),
      ]);
      const disposalValues = entryForm.getFieldsValue();
      const addressParts = [
        barangays.find((b) => b.code === companyValues.companyBarangay)?.name,
        municipalities.find((m) => m.code === companyValues.companyMunicipality)
          ?.name,
        provinces.find((p) => p.code === companyValues.companyProvince)?.name,
        regions.find((r) => r.code === companyValues.companyRegion)?.name,
      ].filter(Boolean);
      const resolvedAddress =
        disposalValues.address ||
        companyValues.address ||
        addressParts.join(", ");
      // Compute legacy totals from entries for backward compat
      const wasteTypeOf = (entry) => String(entry?.wasteType || "").trim().toLowerCase();
      const isLegacyInertHazard = (entry) => wasteTypeOf(entry) === "inert/hazardous waste";
      const isResidualEntry = (entry) => wasteTypeOf(entry).includes("residual");
      const isHazardousEntry = (entry) => wasteTypeOf(entry).includes("hazard") && !isLegacyInertHazard(entry);
      const isInertEntry = (entry) => wasteTypeOf(entry).includes("inert") || isLegacyInertHazard(entry);
      const sumCellEntries = (entries, predicate) =>
        entries.filter(predicate).reduce((sum, entry) => sum + (Number(entry.volume) || 0), 0);
      const activeCellResidualVolume =
        sumCellEntries(activeCellEntries, isResidualEntry) ||
        baselineValues.activeCellResidualVolume ||
        undefined;
      const activeCellInertVolume =
        sumCellEntries(activeCellEntries, isInertEntry) ||
        baselineValues.activeCellInertVolume ||
        undefined;
      const activeCellHazardousVolume =
        sumCellEntries(activeCellEntries, isHazardousEntry) ||
        baselineValues.activeCellHazardousVolume ||
        undefined;
      const closedCellResidualVolume =
        sumCellEntries(closedCellEntries, isResidualEntry) ||
        baselineValues.closedCellResidualVolume ||
        undefined;
      const closedCellInertVolume =
        sumCellEntries(closedCellEntries, isInertEntry) ||
        baselineValues.closedCellInertVolume ||
        undefined;
      const closedCellHazardousVolume =
        sumCellEntries(closedCellEntries, isHazardousEntry) ||
        baselineValues.closedCellHazardousVolume ||
        undefined;

      await api.patch(
        `/data-slf/portal-save-baseline/${encodeURIComponent(activeSlfName)}`,
        {
          submittedBy: portalUser?.email,
          slfGenerator: activeSlfId || null,
          lguCompanyName:
            companyValues.lguCompanyName || slfInfo?.lgu || activeSlfName,
          companyType:
            companyValues.companyType ||
            ((slfInfo?.ownership || "").toLowerCase().includes("private")
              ? "Private"
              : "LGU"),
          address: resolvedAddress,
          companyRegion: companyValues.companyRegion,
          companyProvince: companyValues.companyProvince,
          companyMunicipality: companyValues.companyMunicipality,
          companyBarangay: companyValues.companyBarangay,
          baselineUnit,
          totalVolumeAccepted: baselineValues.totalVolumeAccepted,
          totalVolumeAcceptedUnit: baselineUnit,
          activeCellResidualVolume,
          activeCellResidualUnit: baselineUnit,
          activeCellInertVolume,
          activeCellInertUnit: baselineUnit,
          activeCellHazardousVolume,
          activeCellHazardousUnit: baselineUnit,
          closedCellResidualVolume,
          closedCellResidualUnit: baselineUnit,
          closedCellInertVolume,
          closedCellInertUnit: baselineUnit,
          closedCellHazardousVolume,
          closedCellHazardousUnit: baselineUnit,
          activeCellEntries: activeCellEntries.map(({ key, ...rest }) => ({
            ...rest,
            unit: rest.unit || baselineUnit,
          })),
          closedCellEntries: closedCellEntries.map(({ key, ...rest }) => ({
            ...rest,
            unit: rest.unit || baselineUnit,
          })),
          accreditedHaulers: mergeHaulersByName(haulers, baselineUnit).map(
            ({ key, vehicles, privateSectorClients, ...rest }) => ({
              ...rest,
              numberOfTrucks: rest.numberOfTrucks || vehicles?.length || 0,
              vehicles: (vehicles || []).map(
                ({ key: vehicleKey, ...vehicle }) => ({
                  ...vehicle,
                  capacityUnit: normalizeUnit(
                    vehicle.capacityUnit || baselineUnit,
                  ),
                }),
              ),
              privateSectorClients: (privateSectorClients || []).map(
                ({ key: clientKey, ...client }) => client,
              ),
            }),
          ),
          acceptsHazardousWaste: Boolean(
            baselineValues.acceptsHazardousWaste ?? acceptsHazardousWaste,
          ),
        },
      );

      setBaselineSaved(true);
      setBaselineUpdatePending(false);

      Swal.fire({
        icon: "success",
        title: "Baseline Updated!",
        text: "Your baseline data has been saved and locked successfully.",
        confirmButtonColor: "#1a3353",
        timer: 2500,
        showConfirmButton: false,
      });
    } catch (err) {
      if (err?.errorFields) {
        Swal.fire({
          icon: "warning",
          title: "Review Baseline Fields",
          text: "Please complete the required baseline and company information before saving.",
          confirmButtonColor: "#1a3353",
        });
        return;
      }
      Swal.fire({
        icon: "error",
        title: "Save Failed",
        text:
          err.response?.data?.message ||
          "Could not save baseline. Please try again.",
      });
    } finally {
      setBaselineSavingLoading(false);
    }
  };

  // ── Save facility management details (Leachate Treatment Plant, gas management, etc.) ──
  const handleSaveFacilityDetails = async (type, data) => {
    if (!activeSlfId) return;
    setFacilityMgmtSaving(true);
    try {
      const payload = { slfName: activeSlfName };
      if (type === "leachate") {
        payload.leachatePondDetails = data.map(
          ({
            _key,
            attachments,
            hasWastewaterTreatmentFacility,
            wastewaterTreatmentFacilityType,
            ...r
          }) => ({ ...r, attachments: [] }),
        );
        payload.hasWastewaterTreatmentFacility =
          !!slfInfo?.hasWastewaterTreatmentFacility;
        payload.wastewaterTreatmentFacilityType = Array.isArray(
          slfInfo?.wastewaterTreatmentFacilityType,
        )
          ? slfInfo.wastewaterTreatmentFacilityType
          : slfInfo?.wastewaterTreatmentFacilityType
            ? [slfInfo.wastewaterTreatmentFacilityType]
            : [];
        payload.wastewaterTreatmentFacilityRemarks =
          slfInfo?.wastewaterTreatmentFacilityRemarks || "";
      }
      if (type === "gasVent")
        payload.gasVentDetails = data.map(({ _key, attachments, ...r }) => ({
          ...r,
          attachments: [],
        }));
      if (type === "trashSlide")
        payload.trashSlideMeasures = data.map(({ _key, ...r }) => r);
      if (type === "firePrev")
        payload.firePrevMeasures = data.map(({ _key, ...r }) => r);
      const { data: updated } = await api.patch(
        `/slf-facilities/portal/${activeSlfId}/facility-details`,
        payload,
      );
      setSlfInfo((prev) => ({ ...prev, ...updated }));
      Swal.fire({
        icon: "success",
        title: "Saved!",
        timer: 1500,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Save Failed",
        text: err.response?.data?.message || "Could not save details.",
      });
    } finally {
      setFacilityMgmtSaving(false);
    }
  };

  // ── Fetch waste received summary ──
  const handleOpenWasteReceived = async ({ openModal = true } = {}) => {
    if (openModal) setWasteReceivedModalOpen(true);
    if (!activeSlfName) return;
    setWasteReceivedLoading(true);
    const cacheKey = `${PORTAL_WASTE_RECEIVED_CACHE_KEY}:${activeSlfId || activeSlfName}`;
    try {
      const data = await fetchWithCache(
        cacheKey,
        async () => {
          const { data: response } = await api.get(
            `/data-slf/waste-received-summary/${encodeURIComponent(activeSlfName)}`,
            { params: { slfId: activeSlfId } },
          );
          return response || {};
        },
        { ttl: PORTAL_CACHE_TTL, staleTtl: PORTAL_CACHE_TTL * 6 },
      );
      setWasteReceivedData({
        lguR3: [],
        lguOutside: [],
        privateIndustry: [],
        baselineClients: [],
        baselineCellBreakdown: [],
        baselineTotals: { m3: 0, tons: 0 },
        submissionClients: [],
        clientBreakdown: [],
        totals: { m3: 0, tons: 0, trucks: 0 },
        ...(data || {}),
      });
    } catch {
      setWasteReceivedData({
        lguR3: [],
        lguOutside: [],
        privateIndustry: [],
        baselineClients: [],
        baselineCellBreakdown: [],
        baselineTotals: { m3: 0, tons: 0 },
        submissionClients: [],
        clientBreakdown: [],
        totals: { m3: 0, tons: 0, trucks: 0 },
      });
    } finally {
      setWasteReceivedLoading(false);
    }
  };

  useEffect(() => {
    if (activeMenu === "overview" && activeSlfName) {
      handleOpenWasteReceived({ openModal: false });
    }
  }, [activeMenu, activeSlfId, activeSlfName]);

  // ── Support Ticket Functions ──
  const fetchSupportTickets = useCallback(async () => {
    if (!portalUser?.email) return;
    setSupportLoading(true);
    try {
      const { data } = await api.get(
        `/support-tickets/my-tickets/${encodeURIComponent(portalUser.email)}`,
      );
      setSupportTickets(
        (data || []).filter((ticket) => !isTestAdminNotice(ticket)),
      );
    } catch {
      /* silent */
    } finally {
      setSupportLoading(false);
    }
  }, [portalUser?.email]);

  const fetchPortalNotifications = useCallback(async () => {
    if (!portalUser?.email) return;
    const recipients = [
      ...new Set([portalUser.email, portalUser._id].filter(Boolean)),
    ];
    try {
      const responses = await Promise.all(
        recipients.map((recipient) =>
          api.get(`/notifications/${encodeURIComponent(recipient)}`, {
            params: {
              limit: 100,
            },
          }),
        ),
      );
      const notificationMap = new Map();
      responses.forEach(({ data }) => {
        (data.notifications || []).forEach((notification) => {
          if (!isTestAdminNotice(notification)) {
            notificationMap.set(notification._id, notification);
          }
        });
      });
      const notifications = Array.from(notificationMap.values()).sort(
        (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
      );
      setPortalNotifications(notifications);
      setPortalUnreadCount(
        notifications.filter((notification) => !notification.read).length,
      );
    } catch {
      /* silent */
    }
  }, [portalUser?.email, portalUser?._id]);

  const isMessageNotification = (notification = {}) =>
    ["admin_message", "message_from_admin"].includes(notification.type) ||
    (notification.type === "support_ticket_reply" &&
      /message from admin|admin sent you a message|admin replied/i.test(
        `${notification.title || ""} ${notification.message || ""}`,
      ));

  const isSupportNotification = (notification = {}) =>
    notification.type === "support_ticket_reply" &&
    !isMessageNotification(notification);

  const markPortalNotificationsRead = useCallback(
    async (category) => {
      const unread = portalNotifications.filter((notification) => {
        if (notification.read) return false;
        if (category === "messages") return isMessageNotification(notification);
        if (category === "support") return isSupportNotification(notification);
        if (category === "history") {
          return [
            "reverted",
            "status_change",
            "submission_edit_approved",
            "submission_edit_rejected",
          ].includes(notification.type);
        }
        if (category === "requests") {
          return [
            "baseline_update_approved",
            "baseline_update_rejected",
          ].includes(notification.type);
        }
        if (category === "all") return true;
        return false;
      });
      if (unread.length === 0) return;
      try {
        await Promise.all(
          unread.map((notification) =>
            api.patch(`/notifications/${notification._id}/read`),
          ),
        );
        await fetchPortalNotifications();
      } catch {
        /* silent */
      }
    },
    [portalNotifications, fetchPortalNotifications],
  );

  const markPortalNotificationRead = useCallback(
    async (notification) => {
      if (!notification?._id || notification.read) return;
      try {
        await api.patch(`/notifications/${notification._id}/read`);
        await fetchPortalNotifications();
      } catch {
        /* silent */
      }
    },
    [fetchPortalNotifications],
  );

  useEffect(() => {
    if (!portalUser?.email) return;
    const sock = connectSocket("portal", portalUser.email);
    const refreshMessages = (payload) => {
      if (
        !payload ||
        [
          "support_ticket_reply",
          "admin_message",
          "message_from_admin",
        ].includes(payload.type)
      ) {
        fetchSupportTickets();
      }
      fetchPortalNotifications();
    };
    fetchPortalNotifications();
    sock.on("notification", refreshMessages);
    sock.on("data-refresh", refreshMessages);
    return () => {
      sock.off("notification", refreshMessages);
      sock.off("data-refresh", refreshMessages);
    };
  }, [portalUser?.email, fetchSupportTickets, fetchPortalNotifications]);

  const handleSubmitTicket = async (values) => {
    setSupportSubmitting(true);
    try {
      await api.post("/support-tickets", {
        portalUser: portalUser?._id,
        portalUserEmail: portalUser?.email,
        portalUserName: `${portalUser?.firstName} ${portalUser?.lastName}`,
        companyName: companyForm.getFieldValue("lguCompanyName") || "",
        slfName: activeSlfName,
        ...values,
      });
      Swal.fire({
        icon: "success",
        title: "Ticket Submitted",
        text: "Your concern has been submitted. Our team will review and respond.",
        confirmButtonColor: "#1a3353",
      });
      fetchSupportTickets();
      setSupportTab("my-tickets");
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Failed",
        text: err.response?.data?.message || "Could not submit ticket.",
      });
    } finally {
      setSupportSubmitting(false);
    }
  };

  const handleSupportReply = async (ticketId) => {
    if (!supportReplyText.trim()) return;
    try {
      await api.post(`/support-tickets/${ticketId}/portal-reply`, {
        message: supportReplyText.trim(),
        repliedBy: portalUser?.email,
        repliedByName: `${portalUser?.firstName} ${portalUser?.lastName}`,
      });
      setSupportReplyText("");
      fetchSupportTickets();
      if (supportDetailModal) {
        const { data } = await api.get(`/support-tickets/${ticketId}`);
        setSupportDetailModal(data);
      }
    } catch {
      /* silent */
    }
  };

  // ── Excel/CSV Upload Handlers ──
  const handleExcelUpload = (file, type) => {
    const effectiveType = type || uploadType || "truck";
    setUploadType(effectiveType);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const jsonData = XLSX.utils
          .sheet_to_json(ws, { defval: "" })
          .filter((row) =>
            Object.values(row || {}).some((value) => cleanUploadText(value) !== ""),
          );
        if (jsonData.length === 0) {
          Swal.fire({
            icon: "warning",
            title: "Empty File",
            text: "No data found in the uploaded file.",
          });
          return;
        }
        const headers = Object.keys(jsonData[0] || {});
        const missingColumns = getUploadMissingColumns(headers, effectiveType);
        setUploadMissingColumns(missingColumns);
        // Normalize column names
        const normalized = jsonData.map((row, i) => {
          const normalized = { key: `upload-${i}-${Date.now()}` };
          for (const [key, value] of Object.entries(row)) {
            const k = uploadHeaderKey(key);
            if (effectiveType === "truck") {
              if (k.includes("ticket") || k.includes("disposal"))
                normalized.disposalTicketNo = cleanUploadText(value);
              else if (k.includes("hauler")) normalized.hauler = cleanUploadText(value);
              else if (k.includes("plate"))
                normalized.plateNumber = cleanUploadText(value);
              else if (k.includes("capacity") && !k.includes("unit"))
                normalized.truckCapacity = parseUploadNumber(value);
              else if (k.includes("volume") && !k.includes("unit"))
                normalized.actualVolume = parseUploadNumber(value);
              else if (k.includes("waste") && k.includes("type"))
                normalized.wasteType = cleanUploadText(value);
              else if (k.includes("haz") || k.includes("code"))
                normalized.hazWasteCode = cleanUploadText(value)
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
            } else {
              if (isNumberOfTrucksHeader(k))
                normalized.numberOfTrucks = parseUploadNumber(value);
              else if (isHaulerNameHeader(k))
                normalized.haulerName = cleanUploadText(value);
              else if (k.includes("office") || k.includes("address"))
                normalized.officeAddress = cleanUploadText(value);
              else if (k.includes("plate"))
                normalized.plateNumber = cleanUploadText(value);
              else if (k.includes("vehicle") || k.includes("type"))
                normalized.vehicleType = cleanUploadText(value);
              else if (k.includes("capacity") && !k.includes("unit"))
                normalized.capacity = parseUploadNumber(value);
              else if (k.includes("capacity") && k.includes("unit"))
                normalized.capacityUnit = normalizeUnit(
                  value || baselineUnit || "m³",
                );
              else if (k.includes("client"))
                normalized.privateSectorClients = cleanUploadText(value)
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
            }
          }
          return {
            ...normalized,
            _errors: getUploadRowErrors(normalized, effectiveType),
          };
        });
        setUploadPreviewData(normalized);

        // Build editable columns
        if (effectiveType === "truck") {
          setUploadPreviewColumns([
            { title: "#", width: 44, render: (_, __, i) => i + 1 },
            {
              title: "Ticket No.",
              dataIndex: "disposalTicketNo",
              key: "disposalTicketNo",
              width: 130,
            },
            { title: "Hauler", dataIndex: "hauler", key: "hauler", width: 170 },
            {
              title: "Plate No.",
              dataIndex: "plateNumber",
              key: "plateNumber",
              width: 120,
            },
            {
              title: "Capacity",
              dataIndex: "truckCapacity",
              key: "truckCapacity",
              width: 110,
            },
            { title: "Volume", dataIndex: "actualVolume", key: "actualVolume", width: 110 },
            { title: "Waste Type", dataIndex: "wasteType", key: "wasteType", width: 150 },
            {
              title: "Validation",
              key: "validation",
              width: 180,
              render: (_, row) =>
                row._errors?.length ? (
                  <Tag color="red">Missing: {row._errors.join(", ")}</Tag>
                ) : (
                  <Tag color="green">Ready</Tag>
                ),
            },
            {
              title: "Actions",
              key: "actions",
              width: 60,
              render: (_, r) => (
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    setUploadPreviewData((prev) =>
                      prev.filter((p) => p.key !== r.key),
                    )
                  }
                />
              ),
            },
          ]);
        } else {
          setUploadPreviewColumns([
            { title: "#", width: 44, render: (_, __, i) => i + 1 },
            {
              title: "Hauler Name",
              dataIndex: "haulerName",
              key: "haulerName",
              width: 180,
            },
            {
              title: "Trucks",
              dataIndex: "numberOfTrucks",
              key: "numberOfTrucks",
              width: 90,
            },
            {
              title: "Office Address",
              dataIndex: "officeAddress",
              key: "officeAddress",
              width: 240,
            },
            {
              title: "Plate No.",
              dataIndex: "plateNumber",
              key: "plateNumber",
              width: 120,
            },
            {
              title: "Vehicle Type",
              dataIndex: "vehicleType",
              key: "vehicleType",
              width: 140,
            },
            { title: "Capacity", dataIndex: "capacity", key: "capacity", width: 110 },
            {
              title: "Validation",
              key: "validation",
              width: 180,
              render: (_, row) =>
                row._errors?.length ? (
                  <Tag color="red">Missing: {row._errors.join(", ")}</Tag>
                ) : (
                  <Tag color="green">Ready</Tag>
                ),
            },
            {
              title: "Actions",
              key: "actions",
              width: 60,
              render: (_, r) => (
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    setUploadPreviewData((prev) =>
                      prev.filter((p) => p.key !== r.key),
                    )
                  }
                />
              ),
            },
          ]);
        }
        setUploadModalOpen(true);
      } catch {
        Swal.fire({
          icon: "error",
          title: "Parse Error",
          text: "Could not parse the uploaded file. Please check the format.",
        });
      }
    };
    reader.readAsArrayBuffer(file);
    return false; // prevent auto upload
  };

  // ── Open upload guide modal first, then trigger file picker on proceed ──
  const openUploadGuide = (type) => {
    setUploadGuideType(type);
    setUploadGuideOpen(true);
  };
  const proceedToFilePicker = () => {
    setUploadGuideOpen(false);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls,.csv";
    input.onchange = (e) => {
      if (e.target.files[0])
        handleExcelUpload(e.target.files[0], uploadGuideType);
    };
    input.click();
  };

  const handleConfirmUpload = () => {
    if (uploadPreviewData.length === 0) return;
    const invalidRows = uploadPreviewData.filter((row) => row._errors?.length);
    if (uploadMissingColumns.length > 0 || invalidRows.length > 0) {
      Swal.fire({
        icon: "warning",
        title: "Preview Has Missing Data",
        text: "Please fix the missing columns or row values shown in the preview before importing.",
        confirmButtonColor: "#1a3353",
      });
      return;
    }
    if (uploadType === "truck") {
      const newTrucks = uploadPreviewData.map((d) => ({
        key: d.key,
        disposalTicketNo: d.disposalTicketNo || "",
        hauler: d.hauler || "",
        plateNumber: d.plateNumber || "",
        truckCapacity: parseUploadNumber(d.truckCapacity),
        truckCapacityUnit: baselineUnit || "m³",
        vehicles: d.plateNumber
          ? [
              {
                plateNumber: d.plateNumber,
                capacity: parseUploadNumber(d.truckCapacity),
                capacityUnit: baselineUnit || "m³",
              },
            ]
          : [],
        actualVolume: parseUploadNumber(d.actualVolume),
        actualVolumeUnit: baselineUnit || "m³",
        wasteType: d.wasteType || "Residual",
        hazWasteCode: d.hazWasteCode || [],
      }));
      setTrucks((prev) => [...prev, ...newTrucks]);
    } else {
      const newHaulers = uploadPreviewData.map((d) => ({
        key: d.key,
        haulerName: d.haulerName || "",
        numberOfTrucks: parseUploadNumber(d.numberOfTrucks),
        officeAddress: d.officeAddress || "",
        vehicles: d.plateNumber || d.vehicleType || !isEmptyUploadValue(d.capacity)
          ? [
              {
                plateNumber: d.plateNumber || "",
                vehicleType: d.vehicleType || "",
                capacity: parseUploadNumber(d.capacity),
                capacityUnit: d.capacityUnit || baselineUnit || "m³",
              },
            ]
          : [],
        privateSectorClients: d.privateSectorClients || [],
      }));
      setHaulers((prev) =>
        mergeHaulersByName([...prev, ...newHaulers], baselineUnit || "m³"),
      );
    }
    setUploadModalOpen(false);
    setUploadPreviewData([]);
    setUploadMissingColumns([]);
    Swal.fire({
      icon: "success",
      title: "Data Imported",
      text: `${uploadPreviewData.length} records imported successfully.`,
      timer: 1500,
      showConfirmButton: false,
    });
  };

  // Update preview data cell
  const updateUploadCell = (key, field, value) => {
    setUploadPreviewData((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        const updated = { ...row, [field]: value };
        return {
          ...updated,
          _errors: getUploadRowErrors(updated, uploadType || "truck"),
        };
      }),
    );
  };

  const cleanClientForSubmit = (client) => {
    if (!client || typeof client !== "object") return client;
    const { key, ...rest } = client;
    return rest;
  };

  const cleanTruckForSubmit = ({ key, vehicles, selectedClients, ...rest }) => {
    const cleanedVehicles = (vehicles || []).map(
      ({ key: vehicleKey, selectedClients: vehicleClients, ...vehicle }) => ({
        ...vehicle,
        selectedClients: (vehicleClients || []).map(cleanClientForSubmit),
      }),
    );
    const flattenedClients = cleanedVehicles.flatMap(
      (vehicle) => vehicle.selectedClients || [],
    );
    return {
      ...rest,
      selectedClients: (selectedClients || []).length
        ? selectedClients.map(cleanClientForSubmit)
        : flattenedClients,
      vehicles: cleanedVehicles,
    };
  };

  // ── Baseline unit change handler ──
  const handleBaselineUnitChange = (unit) => {
    setBaselineUnit(unit);
    baselineForm.setFieldsValue({
      baselineUnit: unit,
      totalVolumeAcceptedUnit: unit,
      activeCellResidualUnit: unit,
      activeCellInertUnit: unit,
      activeCellHazardousUnit: unit,
      closedCellResidualUnit: unit,
      closedCellInertUnit: unit,
      closedCellHazardousUnit: unit,
    });
    // Propagate unit to truck draft, existing trucks, and hauler vehicles
    setTruckDraft((prev) => ({
      ...prev,
      truckCapacityUnit: unit,
      actualVolumeUnit: unit,
      vehicles: (prev.vehicles || []).map((v) => ({
        ...v,
        capacityUnit: unit,
      })),
    }));
    setTrucks((prev) =>
      prev.map((t) => ({
        ...t,
        truckCapacityUnit: unit,
        actualVolumeUnit: unit,
        vehicles: (t.vehicles || []).map((v) => ({ ...v, capacityUnit: unit })),
      })),
    );
    setHaulers((prev) =>
      prev.map((h) => ({
        ...h,
        vehicles: (h.vehicles || []).map((v) => ({ ...v, capacityUnit: unit })),
      })),
    );
    setActiveCellDraft((prev) => ({ ...prev, unit }));
    setClosedCellDraft((prev) => ({ ...prev, unit }));
  };

  // ── Edit reverted entry ──
  const [editingRevertedId, setEditingRevertedId] = useState(null);
  const [resubmitComment, setResubmitComment] = useState("");

  const handleEditReverted = (record) => {
    const recordBaselineUnit =
      record.baselineUnit ||
      record.totalVolumeAcceptedUnit ||
      baselineUnit ||
      "m³";
    setBaselineUnit(recordBaselineUnit);
    // Load record data into all forms
    entryForm.setFieldsValue({
      dateOfDisposal: record.dateOfDisposal
        ? dayjs(record.dateOfDisposal)
        : null,
      lguCompanyName: record.lguCompanyName,
      companyType: record.companyType,
      address: record.address,
    });
    companyForm.setFieldsValue({
      lguCompanyName: record.lguCompanyName,
      companyRegion: record.companyRegion,
      companyProvince: record.companyProvince,
      companyMunicipality: record.companyMunicipality,
      companyBarangay: record.companyBarangay,
    });
    baselineForm.setFieldsValue({
      totalVolumeAccepted: record.totalVolumeAccepted,
      baselineUnit: recordBaselineUnit,
      totalVolumeAcceptedUnit:
        record.totalVolumeAcceptedUnit || recordBaselineUnit,
      activeCellResidualVolume: record.activeCellResidualVolume,
      activeCellResidualUnit:
        record.activeCellResidualUnit || recordBaselineUnit,
      activeCellInertVolume: record.activeCellInertVolume,
      activeCellInertUnit: record.activeCellInertUnit || recordBaselineUnit,
      closedCellResidualVolume: record.closedCellResidualVolume,
      closedCellResidualUnit:
        record.closedCellResidualUnit || recordBaselineUnit,
      closedCellInertVolume: record.closedCellInertVolume,
      closedCellInertUnit: record.closedCellInertUnit || recordBaselineUnit,
    });
    setActiveCellEntries(
      (record.activeCellEntries || []).map((entry, index) => ({
        ...entry,
        unit: entry.unit || recordBaselineUnit,
        key: `reverted-active-${index}-${Date.now()}`,
      })),
    );
    setClosedCellEntries(
      (record.closedCellEntries || []).map((entry, index) => ({
        ...entry,
        unit: entry.unit || recordBaselineUnit,
        key: `reverted-closed-${index}-${Date.now()}`,
      })),
    );
    // Load trucks
    const loadedTrucks = (record.trucks || []).map((t, i) => ({
      ...t,
      key: `reverted-${i}-${Date.now()}`,
    }));
    setTrucks(loadedTrucks);
    // Load haulers
    setHaulers(
      mergeHaulersByName(record.accreditedHaulers || [], recordBaselineUnit),
    );
    setEditingRevertedId(record._id);
    setSubmitted(false);
    setBaselineSaved(true);
    setHistoryDetailModal(null);
    setActiveMenu("data-entry");
    setActiveTab("disposal");
    // Cascade address dropdowns if codes are available
    if (record.companyRegion) fetchProvinces(record.companyRegion);
    if (record.companyProvince) fetchMunicipalities(record.companyProvince);
    if (record.companyMunicipality) fetchBarangays(record.companyMunicipality);
    Swal.fire({
      icon: "info",
      title: "Edit Reverted Entry",
      html: `<b>Reason for revert:</b> ${record.revertReason || "Not specified"}<br/><br/>Please review and update the data across all tabs, then submit again.`,
      confirmButtonColor: "#1a3353",
    });
  };

  const handleResubmitReverted = async () => {
    if (!navigator.onLine) {
      showError({
        type: "offline",
        title: "You\u2019re Offline",
        message: "Please check your internet connection and try again.",
      });
      return;
    }
    setLoading(true);
    try {
      const companyValues = companyForm.getFieldsValue();
      const disposalValues = entryForm.getFieldsValue();
      const baselineValues = baselineForm.getFieldsValue();
      const entry = {
        ...disposalValues,
        ...companyValues,
        lguCompanyName:
          companyValues.lguCompanyName || disposalValues.lguCompanyName || "",
        companyType:
          companyValues.companyType ||
          disposalValues.companyType ||
          ((slfInfo?.ownership || "").toLowerCase().includes("private")
            ? "Private"
            : "LGU"),
        address: companyValues.address || disposalValues.address || "",
        slfName: activeSlfName,
        slfGenerator: activeSlfId || null,
        dateOfDisposal: disposalValues.dateOfDisposal
          ? disposalValues.dateOfDisposal.format("YYYY-MM-DD")
          : null,
        baselineUnit,
        totalVolumeAccepted: baselineValues.totalVolumeAccepted,
        totalVolumeAcceptedUnit: baselineUnit,
        activeCellResidualVolume: baselineValues.activeCellResidualVolume,
        activeCellResidualUnit: baselineUnit,
        activeCellInertVolume: baselineValues.activeCellInertVolume,
        activeCellInertUnit: baselineUnit,
        activeCellHazardousVolume: baselineValues.activeCellHazardousVolume,
        activeCellHazardousUnit: baselineUnit,
        closedCellResidualVolume: baselineValues.closedCellResidualVolume,
        closedCellResidualUnit: baselineUnit,
        closedCellInertVolume: baselineValues.closedCellInertVolume,
        closedCellInertUnit: baselineUnit,
        closedCellHazardousVolume: baselineValues.closedCellHazardousVolume,
        closedCellHazardousUnit: baselineUnit,
        activeCellEntries: activeCellEntries.map(({ key, ...rest }) => ({
          ...rest,
          unit: rest.unit || baselineUnit,
        })),
        closedCellEntries: closedCellEntries.map(({ key, ...rest }) => ({
          ...rest,
          unit: rest.unit || baselineUnit,
        })),
        accreditedHaulers: mergeHaulersByName(haulers, baselineUnit).map(
          ({ key, vehicles, privateSectorClients, ...rest }) => ({
            ...rest,
            numberOfTrucks: rest.numberOfTrucks || vehicles?.length || 0,
            vehicles: (vehicles || []).map(
              ({ key: vehicleKey, ...vehicle }) => ({
                ...vehicle,
                capacityUnit: normalizeUnit(
                  vehicle.capacityUnit || baselineUnit,
                ),
              }),
            ),
            privateSectorClients: (privateSectorClients || []).map(
              ({ key: clientKey, ...client }) => client,
            ),
          }),
        ),
        acceptsHazardousWaste,
        trucks: trucks.map(cleanTruckForSubmit),
      };
      // Update the existing entry and set status back to pending
      await api.put(`/data-slf/${editingRevertedId}`, {
        ...entry,
        resubmitComment,
      });
      setReviewModalOpen(false);
      setEditingRevertedId(null);
      setResubmitComment("");
      Swal.fire({
        icon: "success",
        title: "Resubmitted Successfully!",
        html: "Your updated disposal data has been resubmitted for review.",
        confirmButtonColor: "#1a3353",
      });
      setSubmitted(true);
      setTrucks([]);
      setTruckDraft({ ...EMPTY_TRUCK });
      setEditingTruckKey(null);
      entryForm.resetFields();
      setActiveTab("disposal");
      fetchSubmissions();
    } catch (err) {
      showError({
        type: "error",
        title: "Resubmission Failed",
        message: err.response?.data?.message || "Something went wrong.",
      });
    } finally {
      setLoading(false);
    }
  };

  // ── Review & Submit handlers ──

  const handleReviewOpen = async () => {
    try {
      await companyForm.validateFields();
    } catch {
      showError({
        type: "warning",
        title: "Incomplete Company Info",
        message:
          "Please complete the Company Information in the Basic Information tab.",
      });
      setActiveTab("basic-info");
      return;
    }
    if (!baselineSaved) {
      try {
        await baselineForm.validateFields();
      } catch {
        showError({
          type: "warning",
          title: "Incomplete Baseline",
          message: "Please complete the Baseline Data tab first.",
        });
        setActiveTab("baseline");
        return;
      }
    }
    try {
      await entryForm.validateFields();
    } catch {
      showError({
        type: "warning",
        title: "Incomplete Disposal Report",
        message:
          "Please complete all required fields in the Disposal Report tab.",
      });
      setActiveTab("disposal");
      return;
    }
    if (trucks.length === 0) {
      showError({
        type: "warning",
        title: "No Entries Added",
        message: "Please add at least one transport entry.",
      });
      setActiveTab("disposal");
      return;
    }
    const companyVals = companyForm.getFieldsValue();
    if (!companyVals?.lguCompanyName) {
      showError({
        type: "warning",
        title: "Incomplete Waste Generator Info",
        message:
          "Please fill in Company Name in the Waste Generator's Information tab.",
      });
      setActiveTab("basic-info");
      return;
    }
    if (missingHazardousCodeTrucks.length > 0) {
      const list = missingHazardousCodeTrucks
        .map(
          (truck, index) =>
            truck.disposalTicketNo || truck.plateNumber || `Truck ${index + 1}`,
        )
        .join(", ");
      showError({
        type: "warning",
        title: "Hazardous Waste Code Required",
        message: `Please encode Hazardous Waste Code for Treated Hazardous Waste entries: ${list}.`,
      });
      setActiveTab("disposal");
      return;
    }
    setReviewModalOpen(true);
  };

  const handleConfirmSubmit = async () => {
    if (!navigator.onLine) {
      showError({
        type: "offline",
        title: "You\u2019re Offline",
        message: "Please check your internet connection and try again.",
      });
      return;
    }
    setLoading(true);
    try {
      const companyValues = companyForm.getFieldsValue();
      const disposalValues = entryForm.getFieldsValue();
      const baselineValues = baselineForm.getFieldsValue();
      const entry = {
        ...disposalValues,
        ...companyValues,
        // Company info comes from companyForm / entryForm
        lguCompanyName:
          companyValues.lguCompanyName || disposalValues.lguCompanyName || "",
        companyType:
          companyValues.companyType ||
          disposalValues.companyType ||
          ((slfInfo?.ownership || "").toLowerCase().includes("private")
            ? "Private"
            : "LGU"),
        address: companyValues.address || disposalValues.address || "",
        slfName: activeSlfName,
        slfGenerator: activeSlfId || null,
        dateOfDisposal: disposalValues.dateOfDisposal
          ? disposalValues.dateOfDisposal.format("YYYY-MM-DD")
          : null,
        trucks: trucks.map(cleanTruckForSubmit),
        totalVolumeAccepted: baselineValues.totalVolumeAccepted,
        totalVolumeAcceptedUnit: baselineUnit,
        activeCellResidualVolume: baselineValues.activeCellResidualVolume,
        activeCellResidualUnit: baselineUnit,
        activeCellInertVolume: baselineValues.activeCellInertVolume,
        activeCellInertUnit: baselineUnit,
        activeCellHazardousVolume: baselineValues.activeCellHazardousVolume,
        activeCellHazardousUnit: baselineUnit,
        closedCellResidualVolume: baselineValues.closedCellResidualVolume,
        closedCellResidualUnit: baselineUnit,
        closedCellInertVolume: baselineValues.closedCellInertVolume,
        closedCellInertUnit: baselineUnit,
        closedCellHazardousVolume: baselineValues.closedCellHazardousVolume,
        closedCellHazardousUnit: baselineUnit,
        activeCellEntries: activeCellEntries.map(({ key, ...rest }) => ({
          ...rest,
          unit: rest.unit || baselineUnit,
        })),
        closedCellEntries: closedCellEntries.map(({ key, ...rest }) => ({
          ...rest,
          unit: rest.unit || baselineUnit,
        })),
        accreditedHaulers: mergeHaulersByName(haulers, baselineUnit).map(
          ({ key, vehicles, privateSectorClients, ...rest }) => ({
            ...rest,
            numberOfTrucks: rest.numberOfTrucks || vehicles?.length || 0,
            vehicles: (vehicles || []).map(
              ({ key: vehicleKey, ...vehicle }) => ({
                ...vehicle,
                capacityUnit: normalizeUnit(
                  vehicle.capacityUnit || baselineUnit,
                ),
              }),
            ),
            privateSectorClients: (privateSectorClients || []).map(
              ({ key: clientKey, ...client }) => client,
            ),
          }),
        ),
        acceptsHazardousWaste,
        baselineUnit,
      };
      await api.post("/data-slf", {
        entries: [entry],
        submittedBy: portalUser?.email,
      });
      setReviewModalOpen(false);
      Swal.fire({
        icon: "success",
        title: "Submitted Successfully!",
        html: "Your disposal data has been recorded.",
        confirmButtonColor: "#1a3353",
      });
      setSubmitted(true);
      setTrucks([]);
      setTruckDraft({ ...EMPTY_TRUCK });
      setEditingTruckKey(null);
      entryForm.resetFields();
      setBaselineSaved(true);
      setActiveTab("disposal");
    } catch (err) {
      if (
        !navigator.onLine ||
        err.code === "ERR_NETWORK" ||
        err.message === "Network Error"
      ) {
        showError({
          type: "offline",
          title: "Connection Lost",
          message:
            "Your internet connection was interrupted. Your data is still here \u2014 please try submitting again once you\u2019re back online.",
        });
      } else if (err.code === "ECONNABORTED") {
        showError({
          type: "error",
          title: "Request Timed Out",
          message: "The server took too long to respond. Please try again.",
        });
      } else {
        showError({
          type: "error",
          title: "Submission Failed",
          message:
            err.response?.data?.message ||
            "Something went wrong. Please try again.",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Truck table columns ──

  const truckColumns = [
    { title: "#", key: "index", width: 40, render: (_, __, i) => i + 1 },
    {
      title: "Ticket No.",
      dataIndex: "disposalTicketNo",
      key: "disposalTicketNo",
      render: (v) => v || "—",
    },
    { title: "Hauler", dataIndex: "hauler", key: "hauler" },
    {
      title: "Plate No.",
      key: "plateNumber",
      render: (_, t) => {
        const vehs = t.vehicles || [];
        if (vehs.length > 1)
          return (
            vehs
              .map((v) => v.plateNumber)
              .filter(Boolean)
              .join(", ") ||
            t.plateNumber ||
            "—"
          );
        return vehs[0]?.plateNumber || t.plateNumber || "—";
      },
    },
    {
      title: "Capacity",
      key: "cap",
      render: (_, t) => {
        const vehs = t.vehicles || [];
        if (vehs.length > 1)
          return (
            vehs
              .filter((v) => v.capacity != null)
              .map(
                (v) =>
                  `${v.capacity} ${(v.capacityUnit || "m³").replace("m3", "m³")}`,
              )
              .join(", ") || "—"
          );
        const cap = vehs[0]?.capacity ?? t.truckCapacity;
        const unit = vehs[0]?.capacityUnit || t.truckCapacityUnit || "m³";
        return cap != null ? `${cap} ${unit.replace("m3", "m³")}` : "—";
      },
    },
    {
      title: "Actual Volume",
      key: "vol",
      render: (_, t) =>
        t.actualVolume != null
          ? `${t.actualVolume} ${t.actualVolumeUnit || "tons"}`
          : "—",
    },
    {
      title: "Waste Type",
      dataIndex: "wasteType",
      key: "wasteType",
      render: (v) => v || "—",
    },
    {
      title: "Haz. Code",
      dataIndex: "hazWasteCode",
      key: "hazWasteCode",
      render: (v) => v || "—",
    },
    {
      title: "Actions",
      key: "actions",
      width: 100,
      render: (_, t) => (
        <Space size="small">
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openTruckModal(t)}
            style={{ color: "#1a3353" }}
          />
          <Button
            type="text"
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => removeTruck(t.key)}
          />
        </Space>
      ),
    },
  ];

  // Hauler table columns
  const haulerColumns = [
    { title: "#", key: "index", width: 40, render: (_, __, i) => i + 1 },
    { title: "Accredited Hauler", dataIndex: "haulerName", key: "haulerName" },
    {
      title: "Trucks",
      dataIndex: "numberOfTrucks",
      key: "numberOfTrucks",
      width: 70,
    },
    {
      title: "Vehicles",
      key: "vehicles",
      render: (_, h) => {
        const veh =
          h.vehicles?.length > 0
            ? h.vehicles
            : h.plateNumber || h.vehicleType
              ? [
                  {
                    plateNumber: h.plateNumber,
                    vehicleType: h.vehicleType,
                    capacity: h.capacity,
                    capacityUnit: h.capacityUnit,
                  },
                ]
              : [];
        if (veh.length === 0) return "—";
        return veh.map((v, i) => (
          <div key={i} style={{ fontSize: 12, lineHeight: "18px" }}>
            {v.vehicleType || "—"} · {v.plateNumber || "—"}
            {v.capacity != null
              ? ` · ${v.capacity} ${(v.capacityUnit || "m³").replace("m3", "m³")}`
              : ""}
          </div>
        ));
      },
    },
    {
      title: "Clients",
      dataIndex: "privateSectorClients",
      key: "privateSectorClients",
      render: (v) => {
        const arr = Array.isArray(v) ? v : v ? [v] : [];
        if (arr.length === 0) return "—";
        return arr.map((c, i) => {
          const name = typeof c === "string" ? c : c.clientName;
          const type = typeof c === "string" ? null : c.clientType;
          return (
            <div key={i} style={{ fontSize: 12, lineHeight: "18px" }}>
              {name}
              {type ? (
                <Tag
                  color={type === "LGU" ? "blue" : "green"}
                  style={{ marginLeft: 4, fontSize: 10 }}
                >
                  {type}
                </Tag>
              ) : null}
            </div>
          );
        });
      },
    },
    {
      title: "Actions",
      key: "actions",
      width: 100,
      render: (_, h) => (
        <Space size="small">
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openHaulerModal(h)}
            style={{ color: "#1a3353" }}
          />
          <Tooltip
            title={baselineSaved ? "Request hauler deletion" : "Remove hauler"}
          >
            <Button
              type="text"
              danger
              size="small"
              icon={<DeleteOutlined />}
              onClick={() => {
                if (!baselineSaved) {
                  removeHauler(h.key);
                  return;
                }
                setHaulerDeleteReason("");
                setHaulerDeleteFile(null);
                setHaulerDeleteModal({ open: true, hauler: h });
              }}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  // History table columns
  const historyColumns = [
    { title: "#", key: "index", width: 50, render: (_, __, i) => i + 1 },
    { title: "ID No.", dataIndex: "idNo", key: "idNo" },
    {
      title: "Date of Disposal",
      dataIndex: "dateOfDisposal",
      key: "dateOfDisposal",
      render: (v) => (v ? dayjs(v).format("MM/DD/YYYY") : "—"),
    },
    {
      title: "Company / Address",
      key: "companyAddr",
      render: (_, r) => (
        <div>
          <Text strong style={{ fontSize: 13 }}>
            {r.lguCompanyName}
          </Text>
          {r.address && (
            <div style={{ fontSize: 12, color: "#888" }}>{r.address}</div>
          )}
        </div>
      ),
    },
    {
      title: "Type",
      dataIndex: "companyType",
      key: "companyType",
      render: (v) => <Tag color={v === "LGU" ? "blue" : "green"}>{v}</Tag>,
    },
    {
      title: "Entries",
      key: "truckCount",
      width: 70,
      render: (_, r) => r.trucks?.length || 0,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      filters: [
        { text: "Pending", value: "pending" },
        { text: "Approved", value: "acknowledged" },
        { text: "Rejected", value: "rejected" },
        { text: "Reverted", value: "reverted" },
      ],
      onFilter: (value, record) => record.status === value,
      render: (v, r) => {
        if (v === "acknowledged") {
          return (
            <Space direction="vertical" size={2}>
              <Tag icon={<CheckCircleOutlined />} color="success">
                APPROVED
              </Tag>
              {r.revertRequested && (
                <Tag color="orange" style={{ fontSize: 11 }}>
                  Revert Requested
                </Tag>
              )}
            </Space>
          );
        }
        if (v === "rejected") {
          return (
            <Tag icon={<CloseCircleOutlined />} color="error">
              REJECTED
            </Tag>
          );
        }
        if (v === "reverted") {
          return (
            <Space direction="vertical" size={2}>
              <Tag icon={<UndoOutlined />} color="volcano">
                REVERTED
              </Tag>
              {r.revertReason && (
                <Text type="secondary" style={{ fontSize: 10 }}>
                  {r.revertReason}
                </Text>
              )}
            </Space>
          );
        }
        return (
          <Tag
            icon={<SyncOutlined spin />}
            color="warning"
            className="status-pending"
          >
            PENDING
          </Tag>
        );
      },
    },
    {
      title: "Submitted",
      dataIndex: "createdAt",
      key: "createdAt",
      render: (v) => dayjs(v).format("MMM D, YYYY h:mm A"),
    },
    {
      title: "Actions",
      key: "actions",
      width: 150,
      render: (_, r) => (
        <Space size="small">
          <Tooltip title="View Details">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => setHistoryDetailModal(r)}
              style={{ color: "#1a3353" }}
            />
          </Tooltip>
          {r.status === "acknowledged" &&
            !r.revertRequested &&
            !r.editRequested && (
              <Tooltip title="Request Edit">
                <Button
                  type="text"
                  size="small"
                  icon={<UndoOutlined />}
                  onClick={() => openRevertModal(r)}
                  style={{ color: "#fa8c16" }}
                />
              </Tooltip>
            )}
          {r.editRequested &&
            r.status !== "reverted" &&
            r.status !== "editApproved" && (
              <Tag color="processing" style={{ fontSize: 11 }}>
                Edit Pending
              </Tag>
            )}
          {(r.status === "reverted" || r.status === "editApproved") && (
            <Tooltip title="Edit & Resubmit">
              <Button
                type="primary"
                size="small"
                icon={<EditOutlined />}
                onClick={() => handleEditReverted(r)}
                style={{ background: "#fa541c", borderColor: "#fa541c" }}
              >
                Edit
              </Button>
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  if (loadingUser) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  const fieldErr = (name) =>
    truckErrors[name]
      ? { validateStatus: "error", help: truckErrors[name] }
      : {};

  const haulerFieldErr = (name) =>
    haulerErrors[name]
      ? { validateStatus: "error", help: haulerErrors[name] }
      : {};

  // Helper: render status tag for detail modal
  const renderStatusTag = (v, r) => {
    if (v === "acknowledged")
      return (
        <Tag icon={<CheckCircleOutlined />} color="success">
          APPROVED
        </Tag>
      );
    if (v === "rejected")
      return (
        <Tag icon={<CloseCircleOutlined />} color="error">
          REJECTED
        </Tag>
      );
    return (
      <Tag icon={<SyncOutlined spin />} color="warning">
        PENDING
      </Tag>
    );
  };

  const renderGuideItems = (items = [], color = "#1677ff") => (
    <List
      size="small"
      dataSource={items}
      renderItem={(item, index) => (
        <List.Item
          style={{ fontSize: 12, paddingLeft: 0, alignItems: "flex-start" }}
        >
          <Space size={8} align="start">
            <Avatar
              size={22}
              className="slf-guide-icon"
              style={{
                background: `${color}18`,
                color,
                border: `1px solid ${color}33`,
                flex: "0 0 auto",
                animationDelay: `${index * 0.14}s`,
              }}
              icon={
                index % 3 === 0 ? (
                  <BulbOutlined />
                ) : index % 3 === 1 ? (
                  <ThunderboltOutlined />
                ) : (
                  <RocketOutlined />
                )
              }
            />
            <Text style={{ fontSize: 12, lineHeight: 1.45 }}>{item}</Text>
          </Space>
        </List.Item>
      )}
    />
  );

  const revertedCount = submissions.filter(
    (s) => s.status === "reverted",
  ).length;
  const unreadPortalNotifications = portalNotifications.filter(
    (notification) => !notification.read,
  );
  const portalNotificationCounts = {
    total: portalUnreadCount,
    messages: unreadPortalNotifications.filter(isMessageNotification).length,
    support: unreadPortalNotifications.filter(isSupportNotification).length,
    history: unreadPortalNotifications.filter((notification) =>
      [
        "reverted",
        "status_change",
        "submission_edit_approved",
        "submission_edit_rejected",
      ].includes(notification.type),
    ).length,
    requests: unreadPortalNotifications.filter((notification) =>
      ["baseline_update_approved", "baseline_update_rejected"].includes(
        notification.type,
      ),
    ).length,
  };
  const historyBadgeCount = revertedCount + portalNotificationCounts.history;
  const getPortalNotificationMeta = (notification = {}) => {
    if (isMessageNotification(notification)) {
      return {
        label: "Admin Message",
        color: "blue",
        icon: <MessageOutlined />,
        action: "messages",
      };
    }
    if (isSupportNotification(notification)) {
      return {
        label: "Support Ticket",
        color: "purple",
        icon: <CustomerServiceOutlined />,
        action: "support",
      };
    }
    if (
      [
        "reverted",
        "status_change",
        "submission_edit_approved",
        "submission_edit_rejected",
      ].includes(notification.type)
    ) {
      const rejected = /rejected|reverted/i.test(
        `${notification.type} ${notification.title || ""}`,
      );
      return {
        label: rejected ? "Submission Update" : "Submission Status",
        color: rejected ? "red" : "green",
        icon: rejected ? <CloseCircleOutlined /> : <HistoryOutlined />,
        action: "history",
      };
    }
    if (
      ["baseline_update_approved", "baseline_update_rejected"].includes(
        notification.type,
      )
    ) {
      return {
        label: "Request Update",
        color: "geekblue",
        icon: <AuditOutlined />,
        action: "requests",
      };
    }
    return {
      label: "Admin Update",
      color: "default",
      icon: <BellOutlined />,
      action: "none",
    };
  };

  const openPortalNotification = async (notification) => {
    const meta = getPortalNotificationMeta(notification);
    if (meta.action === "messages") {
      setMessageDrawerOpen(true);
      if (supportTickets.length === 0) fetchSupportTickets();
      markPortalNotificationsRead("messages");
    } else if (meta.action === "support") {
      setSupportDrawerOpen(true);
      setSupportTab("my-tickets");
      if (supportTickets.length === 0) fetchSupportTickets();
      markPortalNotificationsRead("support");
    } else if (meta.action === "history") {
      setActiveMenu("history");
      markPortalNotificationsRead("history");
    } else if (meta.action === "requests") {
      setActiveMenu("requests");
      markPortalNotificationsRead("requests");
    } else {
      await markPortalNotificationRead(notification);
    }
    setNotificationPanelOpen(false);
  };

  const portalNotificationPanel = (
    <div
      style={{ width: isMobile ? 300 : 380, maxWidth: "calc(100vw - 32px)" }}
    >
      <Space
        style={{
          width: "100%",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <Space size={6}>
          <BellOutlined style={{ color: "#1677ff" }} />
          <Text strong>Previous Notifications</Text>
          {portalNotificationCounts.total > 0 && (
            <Badge count={portalNotificationCounts.total} size="small" />
          )}
        </Space>
        {portalNotificationCounts.total > 0 && (
          <Button
            size="small"
            type="link"
            onClick={() => markPortalNotificationsRead("all")}
          >
            Mark all read
          </Button>
        )}
      </Space>
      {portalNotifications.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No notifications yet"
        />
      ) : (
        <List
          size="small"
          dataSource={portalNotifications}
          style={{ maxHeight: 420, overflowY: "auto" }}
          renderItem={(notification) => {
            const meta = getPortalNotificationMeta(notification);
            return (
              <List.Item
                onClick={() => openPortalNotification(notification)}
                style={{
                  cursor: "pointer",
                  padding: "10px 8px",
                  borderRadius: 8,
                  background: notification.read ? "#fff" : "#f0f7ff",
                  marginBottom: 4,
                }}
              >
                <List.Item.Meta
                  avatar={
                    <Badge dot={!notification.read}>
                      <Avatar
                        size="small"
                        style={{
                          background: notification.read ? "#f0f0f0" : "#e6f4ff",
                          color: "#1677ff",
                        }}
                        icon={meta.icon}
                      />
                    </Badge>
                  }
                  title={
                    <Space size={6} wrap>
                      <Text strong style={{ fontSize: 13 }}>
                        {notification.title || meta.label}
                      </Text>
                      <Tag
                        color={meta.color}
                        bordered={false}
                        style={{ marginInlineEnd: 0 }}
                      >
                        {meta.label}
                      </Tag>
                    </Space>
                  }
                  description={
                    <div>
                      <Text
                        type="secondary"
                        style={{ fontSize: 12, whiteSpace: "normal" }}
                      >
                        {notification.message ||
                          "Open this update for more details."}
                      </Text>
                      <div>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {notification.createdAt
                            ? dayjs(notification.createdAt).fromNow()
                            : ""}
                        </Text>
                      </div>
                    </div>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
    </div>
  );

  const menuItems = [
    {
      key: "overview",
      icon: <DashboardOutlined />,
      label: "Dashboard",
    },
    {
      key: "data-entry",
      icon: <FileTextOutlined />,
      label: (
        <span>
          Data Entry
          {portalNotificationCounts.total > 0 &&
            activeMenu !== "data-entry" && (
              <Badge dot style={{ marginLeft: 8 }} />
            )}
        </span>
      ),
    },
    {
      key: "history",
      icon: <HistoryOutlined />,
      label: (
        <span>
          Submission History
          {historyBadgeCount > 0 && (
            <Badge
              count={historyBadgeCount}
              size="small"
              style={{ marginLeft: 8, backgroundColor: "#fa541c" }}
            />
          )}
        </span>
      ),
    },
    {
      key: "requests",
      icon: <AuditOutlined />,
      label: (
        <span>
          My Requests
          {portalNotificationCounts.requests > 0 && (
            <Badge
              count={portalNotificationCounts.requests}
              size="small"
              style={{ marginLeft: 8, backgroundColor: "#1677ff" }}
            />
          )}
        </span>
      ),
    },
  ];

  const siderContent = (
    <div>
      <div className="portal-sider-logo">
        <img
          src={embLogo}
          alt="EMBR3"
          style={{ width: 36, marginRight: collapsed && !isMobile ? 0 : 10 }}
        />
        {(!collapsed || isMobile) && (
          <div>
            <Text
              strong
              style={{
                color: "#fff",
                fontSize: 14,
                display: "block",
                lineHeight: 1.2,
              }}
            >
              SLF Portal
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>
              EMBR3 ESWMP
            </Text>
          </div>
        )}
      </div>
      <Menu
        mode="inline"
        selectedKeys={[activeMenu]}
        onClick={({ key }) => {
          setActiveMenu(key);
          if (key === "history") markPortalNotificationsRead("history");
          if (key === "requests") markPortalNotificationsRead("requests");
          if (isMobile) setMobileDrawer(false);
        }}
        items={menuItems}
        style={{ background: "transparent", borderRight: 0, color: "#fff" }}
        theme="dark"
      />
    </div>
  );

  const userDisplay = portalUser
    ? `${portalUser.firstName} ${portalUser.lastName}`
    : "";

  const userMenuItems = [
    {
      key: "info",
      label: (
        <div style={{ padding: "4px 0" }}>
          <Text strong style={{ display: "block" }}>
            {userDisplay}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {portalUser?.email}
          </Text>
          <br />
          <Tag color="blue" style={{ marginTop: 4 }}>
            {activeSlfName}
          </Tag>
        </div>
      ),
      disabled: true,
    },
    { type: "divider" },
    { key: "profile", icon: <UserOutlined />, label: "View Profile" },
    { key: "logout", icon: <LogoutOutlined />, label: "Logout", danger: true },
  ];

  // ── Data Entry Content ──
  const renderUnitMeasurementControl = () => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", border: "1px solid #91caff", borderRadius: 8, background: "#e6f4ff", maxWidth: "100%" }}>
      <DatabaseOutlined style={{ color: "#1677ff" }} />
      {!isMobile && <Text strong style={{ fontSize: 12, color: "#003eb3", whiteSpace: "nowrap" }}>Unit of Measurement</Text>}
      <Select size="small" value={baselineUnit || "m³"} onChange={handleBaselineUnitChange} disabled={baselineSaved} placeholder="Unit" style={{ width: isMobile ? 104 : 150 }}>
        <Option value="m³">m³</Option>
        <Option value="tons">tons</Option>
      </Select>
    </div>
  );

  const renderOverview = () => {
    const ownSubmissions = Array.isArray(submissions) ? submissions : [];
    const volumeTotals = ownSubmissions.reduce((acc, item) => {
      (item.trucks || []).forEach((truck) => {
        const unit = normalizeUnit(truck.actualVolumeUnit || item.baselineUnit || baselineUnit || "m³");
        if (unit === "tons") acc.tons += Number(truck.actualVolume || 0);
        else acc.m3 += Number(truck.actualVolume || 0);
      });
      return acc;
    }, { m3: 0, tons: 0 });
    const statusColors = ["#1677ff", "#52c41a", "#faad14", "#ff4d4f", "#722ed1", "#13c2c2"];
    const cellData = [
      { name: "Active Cells", value: activeCellEntries.length || Number(slfInfo?.activeCells || 0) || 0 },
      { name: "Closed Cells", value: closedCellEntries.length || Number(slfInfo?.closedCells || 0) || 0 },
    ].filter((item) => item.value > 0);
    const legacySubmissionRows = [
      ...(wasteReceivedData.lguR3 || []).map((row) => ({ ...row, clientType: "LGU", region: row.region })),
      ...(wasteReceivedData.lguOutside || []).map((row) => ({ ...row, clientType: "LGU", region: row.region })),
      ...(wasteReceivedData.privateIndustry || []).map((row) => ({ ...row, clientType: "Private", region: row.region })),
    ].filter((row) => Number(row.totalVolume || 0) > 0 || Number(row.entries || 0) > 0);
    const submissionBreakdownRows = (wasteReceivedData.clientBreakdown || wasteReceivedData.submissionClients || []).length
      ? (wasteReceivedData.clientBreakdown || wasteReceivedData.submissionClients || [])
      : legacySubmissionRows;
    const baselineBreakdownRows = (wasteReceivedData.baselineClients || []).length
      ? wasteReceivedData.baselineClients
      : wasteReceivedData.baselineCellBreakdown || [];
    const getBreakdownCategory = (row = {}) => {
      const type = row.clientType || row.companyType || "Private";
      const region = row.region || row.companyRegion || "";
      if (/baseline/i.test(type)) return "Baseline Utilization";
      if (/lgu/i.test(type)) return String(region).startsWith("03") ? "LGU - Region III" : "LGU - Outside Region III";
      return "Private Industry";
    };
    const toCategoryData = (rows) => Object.entries(rows.reduce((acc, row) => {
      const key = getBreakdownCategory(row);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})).map(([name, value]) => ({ name, value }));
    const baselineCategoryData = toCategoryData(baselineBreakdownRows);
    const submissionCategoryData = toCategoryData(submissionBreakdownRows);
    const categoryColors = {
      "LGU - Region III": "#1677ff",
      "LGU - Outside Region III": "#722ed1",
      "Private Industry": "#52c41a",
      "Baseline Utilization": "#fa8c16",
    };
    const wasteFilledM3 = Number(wasteReceivedData.baselineTotals?.m3 || 0) + Number(wasteReceivedData.totals?.m3 || 0);
    const wasteFilledTons = Number(wasteReceivedData.baselineTotals?.tons || 0) + Number(wasteReceivedData.totals?.tons || 0);
    const formatWasteTotal = () => {
      const parts = [];
      if (wasteFilledM3 > 0) parts.push(`${wasteFilledM3.toLocaleString()} m³`);
      if (wasteFilledTons > 0) parts.push(`${wasteFilledTons.toLocaleString()} tons`);
      return parts.join(" / ") || "0";
    };
    const renderBreakdownChart = (title, data, total) => (
      <Card
        size="small"
        title={<Text strong style={{ fontSize: 13 }}>{title}</Text>}
        loading={wasteReceivedLoading}
        style={{ borderRadius: 8, height: "100%" }}
        bodyStyle={{ height: 250 }}
      >
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={3}>
                {data.map((entry, index) => (
                  <RCell key={`${title}-${entry.name}`} fill={categoryColors[entry.name] || statusColors[index % statusColors.length]} />
                ))}
              </Pie>
              <RTooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={total ? "No categorized breakdown" : "No breakdown data yet"} />
        )}
      </Card>
    );

    return (
      <div style={{ maxWidth: 1680, margin: "0 auto" }}>
        <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
          <Col xs={24} md={6}><Card size="small" style={{ borderRadius: 8 }}><Statistic title="My Submissions" value={ownSubmissions.length} valueStyle={{ color: "#1677ff" }} /></Card></Col>
          <Col xs={24} md={6}><Card size="small" style={{ borderRadius: 8 }}><Statistic title="Truck Entries" value={ownSubmissions.reduce((sum, item) => sum + (item.trucks?.length || 0), 0)} /></Card></Col>
          <Col xs={24} md={6}><Card size="small" style={{ borderRadius: 8 }}><Statistic title="Accredited Haulers" value={haulers.length} /></Card></Col>
          <Col xs={24} md={6}><Card size="small" style={{ borderRadius: 8 }}><Statistic title="My Recorded Volume" value={`${volumeTotals.m3 ? `${volumeTotals.m3.toLocaleString()} m³` : ""}${volumeTotals.m3 && volumeTotals.tons ? " / " : ""}${volumeTotals.tons ? `${volumeTotals.tons.toLocaleString()} tons` : ""}` || "0"} valueStyle={{ fontSize: 16, color: "#52c41a" }} /></Card></Col>
        </Row>
        <Row gutter={[12, 12]}>
          <Col xs={24}>
            <Card
              className="slf-section"
              size="small"
              title={<Space><DashboardOutlined /> <Text strong>SLF Overview</Text></Space>}
              style={{ borderRadius: 8 }}
              bodyStyle={{ padding: 12, overflowX: "auto" }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(130px, 1fr))", gap: 8, minWidth: 1080 }}>
                {[["Facility", activeSlfName], ["Province", slfInfo?.province], ["Municipality", slfInfo?.municipality || slfInfo?.city], ["Classification", slfInfo?.category || slfInfo?.classification], ["Status", slfInfo?.operationalStatus || slfInfo?.status], ["Ownership", slfInfo?.ownership], ["ECC No.", slfInfo?.eccNo], ["Permit to Operate", slfInfo?.permitToOperate]].map(([label, value]) => (
                  <div key={label} style={{ padding: "8px 10px", border: "1px solid #eef2f7", borderRadius: 8, minHeight: 58 }}>
                    <Text type="secondary" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</Text>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3353", overflowWrap: "anywhere", lineHeight: 1.25 }}>{value || "Not encoded"}</div>
                  </div>
                ))}
              </div>
            </Card>
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Card title={<Text strong style={{ fontSize: 14 }}>Landfill Cells</Text>} style={{ borderRadius: 8, height: "100%" }} bodyStyle={{ height: 250 }}>
              {cellData.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={cellData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78}>{cellData.map((_, index) => <RCell key={index} fill={index === 0 ? "#52c41a" : "#8c8c8c"} />)}</Pie><RTooltip /><Legend /></PieChart></ResponsiveContainer> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No cell data encoded" />}
            </Card>
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Card title={<Text strong style={{ fontSize: 14 }}>Waste Received Totals</Text>} loading={wasteReceivedLoading} style={{ borderRadius: 8, height: "100%" }} bodyStyle={{ minHeight: 250, display: "flex", alignItems: "center" }}>
              <Row gutter={[12, 14]} style={{ width: "100%" }}>
                <Col xs={24}><Statistic title="Total Waste Filled" value={formatWasteTotal()} valueStyle={{ fontSize: 16, color: "#52c41a" }} /></Col>
                <Col xs={12}><Statistic title="Baseline Categories" value={baselineBreakdownRows.length} valueStyle={{ color: "#1a3353" }} /></Col>
                <Col xs={12}><Statistic title="Submission Groups" value={submissionBreakdownRows.length} valueStyle={{ color: "#fa8c16" }} /></Col>
              </Row>
            </Card>
          </Col>
          <Col xs={24} md={12} xl={6}>
            {renderBreakdownChart("Baseline Breakdown", baselineCategoryData, baselineBreakdownRows.length)}
          </Col>
          <Col xs={24} md={12} xl={6}>
            {renderBreakdownChart("Submission Breakdown", submissionCategoryData, submissionBreakdownRows.length)}
          </Col>
        </Row>
      </div>
    );
  };

  const renderDataEntry = () => {
    if (submitted) {
      return (
        <Card
          className="slf-result-card"
          style={{ maxWidth: 560, margin: "40px auto" }}
        >
          <Result
            status="success"
            icon={<CheckCircleOutlined style={{ color: "#1a3353" }} />}
            title="Submission Successful!"
            subTitle="Your SLF disposal data has been recorded."
            extra={
              <Button
                type="primary"
                size="large"
                onClick={() => setSubmitted(false)}
                className="slf-primary-btn"
              >
                Submit More Data
              </Button>
            }
          />
        </Card>
      );
    }

    return (
      <div style={{ maxWidth: 1680, margin: "0 auto" }}>
        {/* SLF selector for users with multiple assigned SLFs */}
        {Array.isArray(portalUser?.assignedSlfName) &&
          portalUser.assignedSlfName.length > 1 && (
            <Card
              size="small"
              style={{
                marginBottom: 12,
                borderRadius: 10,
                border: "1px solid #91caff",
                background: "#e6f4ff",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <EnvironmentOutlined
                  style={{ color: "#1a3353", fontSize: 16 }}
                />
                <Text strong style={{ fontSize: 13 }}>
                  Select SLF Facility:
                </Text>
                <Select
                  value={selectedSlfIdx}
                  onChange={(val) => {
                    setSelectedSlfIdx(val);
                    setBaselineSaved(false);
                    setSlfInfo(null);
                    setHaulers([]);
                    setTrucks([]);
                    setActiveCellEntries([]);
                    setClosedCellEntries([]);
                    baselineForm.resetFields();
                    companyForm.resetFields();
                    entryForm.resetFields();
                  }}
                  style={{ minWidth: 280 }}
                  options={portalUser.assignedSlfName.map((name, i) => ({
                    label: name,
                    value: i,
                  }))}
                />
              </div>
            </Card>
          )}
        <Row gutter={[16, 16]} align="top">
          <Col xs={24} xl={19}>
            {/* SLF Name (read-only, from assigned SLF) */}
            <Card
              className="slf-section slf-facility-card"
              styles={{
                header: {
                  background:
                    "linear-gradient(135deg, #1a3353 0%, #2d5f8a 100%)",
                  borderRadius: "10px 10px 0 0",
                  padding: isMobile ? "14px 16px" : "16px 24px",
                },
                body: {
                  padding: 0,
                  overflow: "hidden",
                  maxHeight: 0,
                },
              }}
              title={
                <div
                  style={{ display: "flex", alignItems: "center", gap: 10 }}
                >
                  <div
                    style={{
                      color: "rgba(255,255,255,0.8)",
                      fontSize: 14,
                      transition: "transform 0.3s",
                      transform: slfCardExpanded
                        ? "rotate(180deg)"
                        : "rotate(0deg)",
                      display: "none",
                      alignItems: "center",
                    }}
                  >
                    <DownOutlined />
                  </div>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.15)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <BankOutlined style={{ color: "#fff", fontSize: 18 }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <Text
                      strong
                      style={{
                        fontSize: isMobile ? 14 : 16,
                        color: "#fff",
                        display: "block",
                        lineHeight: 1.3,
                      }}
                    >
                      {isMobile
                        ? "Assigned SLF"
                        : "Assigned Sanitary Landfill Facility"}
                    </Text>
                    <Text
                      style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}
                    >
                      {activeSlfName}
                    </Text>
                  </div>
                </div>
              }
              extra={
                <Badge
                  dot={hasReviewMissing}
                  offset={[-2, 4]}
                  style={{ backgroundColor: "#ff4d4f" }}
                >
                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    onClick={handleReviewOpen}
                    loading={loading}
                    className="slf-primary-btn"
                    size={isMobile ? "middle" : "large"}
                    style={{
                      background: "#fff",
                      color: "#1a3353",
                      fontWeight: 600,
                      border: "none",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                    }}
                  >
                    {isMobile ? "Submit" : "Review & Submit"}
                  </Button>
                </Badge>
              }
            >
              {slfInfoLoading ? (
                <div style={{ textAlign: "center", padding: "40px 0" }}>
                  <Spin size="large" />
                  <div style={{ marginTop: 12 }}>
                    <Text type="secondary">Loading facility data...</Text>
                  </div>
                </div>
              ) : slfInfo ? (
                (() => {
                  const dashboardUnit = normalizeUnit(
                    slfInfo.volumeCapacityUnit ||
                      slfInfo.cellCapacityUnits?.find(Boolean) ||
                      slfInfo.cellFillUnits?.find(Boolean) ||
                      baselineUnit ||
                      "m³",
                  );
                  const cellCaps = slfInfo.cellCapacities || [];
                  const cellStatuses = slfInfo.cellStatuses || [];
                  const cellFillValues = slfInfo.cellFillValues || [];
                  const cellFillUnits = slfInfo.cellFillUnits || [];
                  const cellCapacityUnits = slfInfo.cellCapacityUnits || [];
                  const cells = Math.max(
                    Number(slfInfo.numberOfCell || 0),
                    cellCaps.length,
                    cellStatuses.length,
                    cellFillValues.length,
                  );
                  const cellTypes = slfInfo.cellTypes || [];
                  const adminCellRows = Array.from(
                    { length: cells },
                    (_, index) => {
                      const status = normalizeCellStatus(cellStatuses[index]);
                      const capacityUnit = normalizeUnit(
                        cellCapacityUnits[index] ||
                          slfInfo.volumeCapacityUnit ||
                          dashboardUnit,
                      );
                      const fillUnit = normalizeUnit(
                        cellFillUnits[index] ||
                          slfInfo.wasteReceivedUnit ||
                          capacityUnit,
                      );
                      const capacity = Number(cellCaps[index] || 0);
                      const used = convertVolume(
                        cellFillValues[index] || 0,
                        fillUnit,
                        capacityUnit,
                      );
                      const pct =
                        capacity > 0
                          ? Math.min(
                              Math.round(
                                (Math.min(used, capacity) / capacity) * 100,
                              ),
                              100,
                            )
                          : 0;
                      return {
                        index,
                        status,
                        type: cellTypes[index] || "Residual",
                        capacity,
                        capacityUnit,
                        fillUnit,
                        used,
                        pct,
                        remaining:
                          capacity > 0 ? Math.max(0, capacity - used) : 0,
                        isActive: isActiveCellStatus(status),
                        isCompleted: isCompletedCellStatus(status),
                        isUnavailable: isUnavailableCellStatus(status),
                      };
                    },
                  );
                  const capacity =
                    adminCellRows.reduce(
                      (sum, row) =>
                        sum +
                        convertVolume(
                          row.capacity,
                          row.capacityUnit,
                          dashboardUnit,
                        ),
                      0,
                    ) ||
                    convertVolume(
                      slfInfo.volumeCapacity || 0,
                      slfInfo.volumeCapacityUnit || dashboardUnit,
                      dashboardUnit,
                    );
                  const waste =
                    adminCellRows.reduce(
                      (sum, row) =>
                        sum +
                        convertVolume(
                          row.used,
                          row.capacityUnit,
                          dashboardUnit,
                        ),
                      0,
                    ) ||
                    convertVolume(
                      slfInfo.actualResidualWasteReceived || 0,
                      slfInfo.wasteReceivedUnit || dashboardUnit,
                      dashboardUnit,
                    );
                  const pct =
                    capacity > 0
                      ? Math.min(
                          Math.round(
                            (Math.min(waste, capacity) / capacity) * 100,
                          ),
                          100,
                        )
                      : 0;
                  const operationalCells = adminCellRows.filter(
                    (row) => row.isActive,
                  ).length;
                  const closedCells = adminCellRows.filter(
                    (row) => row.isCompleted,
                  ).length;
                  const residualCells =
                    adminCellRows.filter(
                      (row) => row.type !== "Treated Haz Waste",
                    ).length || cells;
                  const hazCells = adminCellRows.filter(
                    (row) => row.type === "Treated Haz Waste",
                  ).length;
                  const capColor =
                    pct >= 90 ? "#ff4d4f" : pct >= 70 ? "#faad14" : "#52c41a";
                  const capLabel =
                    pct >= 90 ? "Critical" : pct >= 70 ? "Warning" : "Normal";
                  const isOp = !slfInfo.statusOfSLF
                    ?.toLowerCase()
                    .includes("non");
                  // Baseline cell breakdown
                  const isResidualEntry = (entry) =>
                    !/haz|inert/i.test(String(entry?.wasteType || "Residual"));
                  const sumEntryVolumes = (entries, predicate) =>
                    entries
                      .filter(predicate)
                      .reduce(
                        (sum, entry) => sum + Number(entry?.volume || 0),
                        0,
                      );
                  const activeCellRes = activeCellEntries.length
                    ? sumEntryVolumes(activeCellEntries, isResidualEntry)
                    : baselineForm.getFieldValue("activeCellResidualVolume") ||
                      0;
                  const activeCellInert = activeCellEntries.length
                    ? sumEntryVolumes(
                        activeCellEntries,
                        (entry) => !isResidualEntry(entry),
                      )
                    : baselineForm.getFieldValue("activeCellInertVolume") || 0;
                  const closedCellRes = closedCellEntries.length
                    ? sumEntryVolumes(closedCellEntries, isResidualEntry)
                    : baselineForm.getFieldValue("closedCellResidualVolume") ||
                      0;
                  const closedCellInert = closedCellEntries.length
                    ? sumEntryVolumes(
                        closedCellEntries,
                        (entry) => !isResidualEntry(entry),
                      )
                    : baselineForm.getFieldValue("closedCellInertVolume") || 0;
                  const hasBaselineCell =
                    activeCellRes > 0 ||
                    activeCellInert > 0 ||
                    closedCellRes > 0 ||
                    closedCellInert > 0;
                  // LGU served split (from baseline hauler clients)
                  const allClients = haulers
                    .flatMap((h) => h.privateSectorClients || [])
                    .filter((c) => c.clientType === "LGU");
                  const lguR3Clients = allClients.filter(
                    (c) =>
                      (c.region || "").startsWith("03") ||
                      (c.regionName || "").toLowerCase().includes("iii") ||
                      (c.regionName || "")
                        .toLowerCase()
                        .includes("central luzon"),
                  );
                  const lguOutsideClients = allClients.filter(
                    (c) =>
                      !(
                        (c.region || "").startsWith("03") ||
                        (c.regionName || "").toLowerCase().includes("iii") ||
                        (c.regionName || "")
                          .toLowerCase()
                          .includes("central luzon")
                      ),
                  );
                  return (
                    <div>
                      {/* Capacity overview banner */}
                      <div
                        style={{
                          background: `linear-gradient(135deg, ${capColor}08 0%, ${capColor}15 100%)`,
                          border: `1px solid ${capColor}30`,
                          borderRadius: 12,
                          padding: isMobile ? 16 : 20,
                          marginBottom: 20,
                        }}
                      >
                        <Row gutter={[20, 16]} align="middle">
                          <Col xs={24} sm={6} style={{ textAlign: "center" }}>
                            <Progress
                              type="dashboard"
                              percent={pct}
                              size={isMobile ? 100 : 120}
                              strokeColor={{ "0%": capColor, "100%": capColor }}
                              strokeWidth={8}
                              format={() => (
                                <div style={{ lineHeight: 1.2 }}>
                                  <div
                                    style={{
                                      fontSize: 22,
                                      fontWeight: 800,
                                      color: capColor,
                                    }}
                                  >
                                    {pct}%
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 10,
                                      color: "#8c8c8c",
                                      fontWeight: 500,
                                    }}
                                  >
                                    UTILIZATION
                                  </div>
                                </div>
                              )}
                            />
                            <Tag
                              color={capColor}
                              style={{
                                marginTop: 6,
                                fontWeight: 600,
                                fontSize: 11,
                              }}
                            >
                              {capLabel}
                            </Tag>
                          </Col>
                          <Col xs={24} sm={18}>
                            <Row gutter={[12, 12]}>
                              {/* Status */}
                              <Col xs={12} sm={12} md={6}>
                                <div
                                  style={{
                                    background: isOp ? "#f6ffed" : "#fff2f0",
                                    borderRadius: 10,
                                    padding: "12px 14px",
                                    border: `1px solid ${isOp ? "#b7eb8f" : "#ffccc7"}`,
                                    height: "100%",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                      marginBottom: 6,
                                    }}
                                  >
                                    <CheckCircleOutlined
                                      style={{
                                        color: isOp ? "#52c41a" : "#ff4d4f",
                                        fontSize: 13,
                                      }}
                                    />
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: "#8c8c8c",
                                        textTransform: "uppercase",
                                        letterSpacing: 0.6,
                                        fontWeight: 600,
                                      }}
                                    >
                                      Status
                                    </span>
                                  </div>
                                  <Tag
                                    color={isOp ? "success" : "error"}
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 600,
                                      padding: "2px 10px",
                                    }}
                                  >
                                    {slfInfo.statusOfSLF || "—"}
                                  </Tag>
                                </div>
                              </Col>
                              {/* Cells: Operational / Closed */}
                              <Col xs={12} sm={12} md={6}>
                                <div
                                  style={{
                                    background: "#e6f7ff",
                                    borderRadius: 10,
                                    padding: "12px 14px",
                                    border: "1px solid #91d5ff",
                                    height: "100%",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                      marginBottom: 6,
                                    }}
                                  >
                                    <ContainerOutlined
                                      style={{ color: "#1890ff", fontSize: 13 }}
                                    />
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: "#8c8c8c",
                                        textTransform: "uppercase",
                                        letterSpacing: 0.6,
                                        fontWeight: 600,
                                      }}
                                    >
                                      Cells
                                    </span>
                                  </div>
                                  {cells > 0 ? (
                                    <div>
                                      <Tag
                                        color="success"
                                        style={{
                                          fontSize: 11,
                                          marginBottom: 2,
                                        }}
                                      >
                                        Op: {operationalCells}
                                      </Tag>
                                      {closedCells > 0 && (
                                        <Tag
                                          color="default"
                                          style={{ fontSize: 11 }}
                                        >
                                          Closed: {closedCells}
                                        </Tag>
                                      )}
                                    </div>
                                  ) : (
                                    <div
                                      style={{
                                        fontSize: 16,
                                        fontWeight: 700,
                                        color: "#1890ff",
                                      }}
                                    >
                                      —
                                    </div>
                                  )}
                                  {cells > 0 && cellTypes.length > 0 && (
                                    <div style={{ marginTop: 4 }}>
                                      <Tag
                                        color="blue"
                                        style={{ fontSize: 10 }}
                                      >
                                        Res: {residualCells}
                                      </Tag>
                                      {hazCells > 0 && (
                                        <Tag
                                          color="red"
                                          style={{ fontSize: 10 }}
                                        >
                                          THW: {hazCells}
                                        </Tag>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </Col>
                              {/* Waste Filled — clickable */}
                              <Col xs={12} sm={12} md={6}>
                                <div
                                  style={{
                                    background: "#fff7e6",
                                    borderRadius: 10,
                                    padding: "12px 14px",
                                    border: "1px solid #ffd591",
                                    height: "100%",
                                    cursor: "pointer",
                                    transition: "box-shadow 0.2s",
                                  }}
                                  onClick={handleOpenWasteReceived}
                                  title="Click to view waste received breakdown"
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                      marginBottom: 6,
                                    }}
                                  >
                                    <BarChartOutlined
                                      style={{ color: "#fa8c16", fontSize: 13 }}
                                    />
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: "#8c8c8c",
                                        textTransform: "uppercase",
                                        letterSpacing: 0.6,
                                        fontWeight: 600,
                                      }}
                                    >
                                      Waste Filled
                                    </span>
                                    <EyeOutlined
                                      style={{
                                        marginLeft: "auto",
                                        color: "#fa8c16",
                                        fontSize: 11,
                                      }}
                                    />
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 16,
                                      fontWeight: 700,
                                      color: "#fa8c16",
                                    }}
                                  >
                                    {waste > 0
                                      ? `${waste.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${dashboardUnit}`
                                      : "—"}
                                  </div>
                                  {adminCellRows.some(
                                    (row) => row.used > 0,
                                  ) && (
                                    <div
                                      style={{
                                        fontSize: 10,
                                        color: "#8c8c8c",
                                        fontWeight: 500,
                                        marginTop: 2,
                                      }}
                                    >
                                      From Cell Infrastructure • Tap for
                                      breakdown
                                    </div>
                                  )}
                                </div>
                              </Col>
                              {/* Volume Capacity + LGUs Served */}
                              <Col xs={12} sm={12} md={6}>
                                <div
                                  style={{
                                    background: "#f9f0ff",
                                    borderRadius: 10,
                                    padding: "12px 14px",
                                    border: "1px solid #d3adf7",
                                    height: "100%",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                      marginBottom: 6,
                                    }}
                                  >
                                    <DatabaseOutlined
                                      style={{ color: "#722ed1", fontSize: 13 }}
                                    />
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: "#8c8c8c",
                                        textTransform: "uppercase",
                                        letterSpacing: 0.6,
                                        fontWeight: 600,
                                      }}
                                    >
                                      Capacity
                                    </span>
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 16,
                                      fontWeight: 700,
                                      color: "#722ed1",
                                    }}
                                  >
                                    {capacity > 0
                                      ? `${capacity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${dashboardUnit}`
                                      : "—"}
                                  </div>
                                  {capacity > 0 && waste > 0 && (
                                    <div
                                      style={{
                                        fontSize: 10,
                                        color: "#8c8c8c",
                                        fontWeight: 500,
                                        marginTop: 2,
                                      }}
                                    >
                                      {Math.max(
                                        0,
                                        capacity - waste,
                                      ).toLocaleString(undefined, {
                                        maximumFractionDigits: 2,
                                      })}{" "}
                                      {dashboardUnit} remaining
                                    </div>
                                  )}
                                </div>
                              </Col>
                            </Row>
                            {/* LGUs Served split */}
                            {allClients.length > 0 && (
                              <div
                                style={{
                                  marginTop: 12,
                                  background: "#f0f5ff",
                                  borderRadius: 10,
                                  padding: "10px 14px",
                                  border: "1px solid #adc6ff",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    marginBottom: 6,
                                  }}
                                >
                                  <TeamOutlined
                                    style={{ color: "#2f54eb", fontSize: 13 }}
                                  />
                                  <span
                                    style={{
                                      fontSize: 10,
                                      color: "#2f54eb",
                                      textTransform: "uppercase",
                                      letterSpacing: 0.6,
                                      fontWeight: 600,
                                    }}
                                  >
                                    LGUs Served
                                  </span>
                                </div>
                                <Space size={8} wrap>
                                  <Tag color="geekblue">
                                    Region III: {lguR3Clients.length}
                                  </Tag>
                                  <Tag color="cyan">
                                    Outside R3: {lguOutsideClients.length}
                                  </Tag>
                                  <Text
                                    style={{ fontSize: 11, color: "#8c8c8c" }}
                                  >
                                    Total: {allClients.length}
                                  </Text>
                                </Space>
                              </div>
                            )}
                          </Col>
                        </Row>
                      </div>

                      {/* Cell Infrastructure & Baseline Utilization — side by side */}
                      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
                        {adminCellRows.length > 0 && (
                          <Col xs={24} md={baselineSaved ? 14 : 24}>
                            <div
                              style={{
                                background: "#fff",
                                borderRadius: 12,
                                padding: isMobile ? 14 : 20,
                                border: "1px solid #e8e8e8",
                                boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                                height: "100%",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  marginBottom: 16,
                                }}
                              >
                                <div
                                  style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: 6,
                                    background: "#1a3353",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                >
                                  <PieChartOutlined
                                    style={{ color: "#fff", fontSize: 13 }}
                                  />
                                </div>
                                <Text
                                  strong
                                  style={{ fontSize: 14, color: "#1a3353" }}
                                >
                                  Cell Infrastructure
                                </Text>
                                <Space size={4} style={{ marginLeft: "auto" }}>
                                  <Tag color="success">
                                    Operational: {operationalCells}
                                  </Tag>
                                  {closedCells > 0 && (
                                    <Tag color="default">
                                      Closed: {closedCells}
                                    </Tag>
                                  )}
                                </Space>
                              </div>
                              <Row gutter={[12, 12]}>
                                {adminCellRows.map((row) => {
                                  const cap = row.capacity;
                                  const cellSt = row.status;
                                  const cellT = row.type;
                                  const isClosed = row.isCompleted;
                                  const isInactive =
                                    row.isCompleted || row.isUnavailable;
                                  const isHaz = cellT === "Treated Haz Waste";
                                  const cellFillUnit = row.capacityUnit;
                                  const cellFill = row.used;
                                  const cellPct = row.pct;
                                  const cellColor = isClosed
                                    ? "#d9d9d9"
                                    : isInactive
                                      ? "#722ed1"
                                      : isHaz
                                        ? cellPct >= 90
                                          ? "#ff4d4f"
                                          : cellPct >= 70
                                            ? "#faad14"
                                            : "#f5222d"
                                        : cellPct >= 90
                                          ? "#ff4d4f"
                                          : cellPct >= 70
                                            ? "#faad14"
                                            : "#52c41a";
                                  const remaining = row.remaining;
                                  return (
                                    <Col
                                      xs={12}
                                      sm={8}
                                      md={Math.min(8, Math.floor(24 / cells))}
                                      key={row.index}
                                    >
                                      <div
                                        style={{
                                          background: isClosed
                                            ? "#fafafa"
                                            : "#fff",
                                          borderRadius: 10,
                                          padding: "14px 12px",
                                          border: `1px solid ${isClosed ? "#e8e8e8" : cellColor}30`,
                                          textAlign: "center",
                                          opacity: isClosed ? 0.7 : 1,
                                        }}
                                      >
                                        <Progress
                                          type="dashboard"
                                          percent={isInactive ? 0 : cellPct}
                                          size={isMobile ? 64 : 80}
                                          strokeWidth={6}
                                          strokeColor={cellColor}
                                          trailColor={
                                            isClosed ? "#bfbfbf" : undefined
                                          }
                                          format={() => (
                                            <span
                                              style={{
                                                fontSize: isMobile ? 13 : 15,
                                                fontWeight: 700,
                                                color: cellColor,
                                              }}
                                            >
                                              {isClosed
                                                ? "—"
                                                : isInactive
                                                  ? "N/A"
                                                  : `${cellPct}%`}
                                            </span>
                                          )}
                                        />
                                        <div
                                          style={{
                                            fontWeight: 700,
                                            fontSize: 13,
                                            color: "#1a3353",
                                            marginTop: 6,
                                          }}
                                        >
                                          Cell {row.index + 1}
                                        </div>
                                        <Tag
                                          color={
                                            isClosed
                                              ? "default"
                                              : isInactive
                                                ? "purple"
                                                : "success"
                                          }
                                          style={{ fontSize: 10, marginTop: 4 }}
                                        >
                                          {cellSt}
                                        </Tag>
                                        <Tag
                                          color={isHaz ? "red" : "blue"}
                                          style={{ fontSize: 10, marginTop: 2 }}
                                        >
                                          {cellT}
                                        </Tag>
                                        <div
                                          style={{
                                            fontSize: 11,
                                            color: "#8c8c8c",
                                            marginTop: 4,
                                            fontWeight: 500,
                                          }}
                                        >
                                          {cap > 0
                                            ? `${cap.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${row.capacityUnit}`
                                            : "—"}
                                        </div>
                                        {!isInactive && cellFill > 0 && (
                                          <div
                                            style={{
                                              fontSize: 10,
                                              marginTop: 3,
                                            }}
                                          >
                                            <span
                                              style={{
                                                color: isHaz
                                                  ? "#f5222d"
                                                  : "#52c41a",
                                                fontWeight: 600,
                                              }}
                                            >
                                              {cellFill.toLocaleString(
                                                undefined,
                                                { maximumFractionDigits: 1 },
                                              )}{" "}
                                              {cellFillUnit}
                                            </span>{" "}
                                            <span style={{ color: "#8c8c8c" }}>
                                              filled
                                            </span>
                                          </div>
                                        )}
                                        {!isInactive &&
                                          cap > 0 &&
                                          remaining > 0 && (
                                            <div
                                              style={{
                                                fontSize: 10,
                                                color: "#8c8c8c",
                                                marginTop: 1,
                                              }}
                                            >
                                              {remaining.toLocaleString(
                                                undefined,
                                                { maximumFractionDigits: 1 },
                                              )}{" "}
                                              {cellFillUnit} remaining
                                            </div>
                                          )}
                                      </div>
                                    </Col>
                                  );
                                })}
                              </Row>
                            </div>
                          </Col>
                        )}
                        {/* Baseline Utilization Breakdown */}
                        {baselineSaved && (
                          <Col xs={24} md={cells > 0 ? 10 : 24}>
                            <div
                              style={{
                                background: "#fff",
                                borderRadius: 12,
                                padding: isMobile ? 14 : 20,
                                border: "1px solid #e8e8e8",
                                boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                                height: "100%",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  marginBottom: 16,
                                }}
                              >
                                <div
                                  style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: 6,
                                    background: "#722ed1",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                >
                                  <DatabaseOutlined
                                    style={{ color: "#fff", fontSize: 13 }}
                                  />
                                </div>
                                <Text
                                  strong
                                  style={{ fontSize: 14, color: "#1a3353" }}
                                >
                                  Baseline Utilization
                                </Text>
                                <Tag
                                  color="purple"
                                  style={{
                                    marginLeft: "auto",
                                    fontWeight: 500,
                                  }}
                                >
                                  From Baseline Data
                                </Tag>
                              </div>
                              {hasBaselineCell ? (
                                <Row gutter={[12, 12]}>
                                  {[
                                    {
                                      label: "Active Cell (Residual)",
                                      value: activeCellRes,
                                      unit: baselineUnit || "m³",
                                      color: "#52c41a",
                                    },
                                    {
                                      label: "Active Cell (Inert)",
                                      value: activeCellInert,
                                      unit: baselineUnit || "m³",
                                      color: "#1890ff",
                                    },
                                    {
                                      label: "Closed Cell (Residual)",
                                      value: closedCellRes,
                                      unit: baselineUnit || "m³",
                                      color: "#fa8c16",
                                    },
                                    {
                                      label: "Closed Cell (Inert)",
                                      value: closedCellInert,
                                      unit: baselineUnit || "m³",
                                      color: "#8c8c8c",
                                    },
                                  ]
                                    .filter((d) => d.value > 0)
                                    .map((item, idx) => (
                                      <Col xs={12} sm={12} md={6} key={idx}>
                                        <div
                                          style={{
                                            background: `${item.color}08`,
                                            borderRadius: 10,
                                            padding: "12px 14px",
                                            border: `1px solid ${item.color}30`,
                                            textAlign: "center",
                                          }}
                                        >
                                          <div
                                            style={{
                                              fontSize: 10,
                                              color: "#8c8c8c",
                                              textTransform: "uppercase",
                                              letterSpacing: 0.5,
                                              fontWeight: 600,
                                              marginBottom: 4,
                                            }}
                                          >
                                            {item.label}
                                          </div>
                                          <div
                                            style={{
                                              fontSize: 16,
                                              fontWeight: 700,
                                              color: item.color,
                                            }}
                                          >
                                            {Number(
                                              item.value,
                                            ).toLocaleString()}
                                          </div>
                                          <div
                                            style={{
                                              fontSize: 10,
                                              color: "#8c8c8c",
                                            }}
                                          >
                                            {item.unit}
                                          </div>
                                        </div>
                                      </Col>
                                    ))}
                                </Row>
                              ) : (
                                <div
                                  style={{
                                    background: "#fff7e6",
                                    border: "1px solid #ffe58f",
                                    borderRadius: 8,
                                    padding: "10px 14px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                  }}
                                >
                                  <InfoCircleOutlined
                                    style={{ color: "#faad14" }}
                                  />
                                  <Text
                                    style={{ color: "#ad6800", fontSize: 12 }}
                                  >
                                    Cell volume breakdown not yet encoded in
                                    baseline data. Request an update to provide
                                    active/closed cell volumes.
                                  </Text>
                                </div>
                              )}
                            </div>
                          </Col>
                        )}
                      </Row>

                      {/* Facility Details */}
                      <div
                        style={{
                          background: "#fff",
                          borderRadius: 12,
                          border: "1px solid #e8e8e8",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "12px 20px",
                            borderBottom: "1px solid #f0f0f0",
                            background: "#fafbfc",
                          }}
                        >
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 6,
                              background: "#1a3353",
                              display: "none",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <FileTextOutlined
                              style={{ color: "#fff", fontSize: 13 }}
                            />
                          </div>
                          <Text
                            strong
                            style={{ fontSize: 14, color: "#1a3353" }}
                          >
                            Facility Details
                          </Text>
                        </div>
                        <div style={{ padding: isMobile ? 12 : 16 }}>
                          <Row gutter={[16, 12]}>
                            {[
                              slfInfo.category && {
                                label: "Category",
                                value: slfInfo.category,
                              },
                              slfInfo.yearStartedOperation && {
                                label: "Year Started",
                                value: slfInfo.yearStartedOperation,
                              },
                              slfInfo.remainingLifeSpan && {
                                label: "Remaining Lifespan",
                                value: slfInfo.remainingLifeSpan,
                              },
                              slfInfo.noOfLeachatePond != null && {
                                label: "Leachate Treatment Plant",
                                value: slfInfo.noOfLeachatePond,
                              },
                              slfInfo.numberOfGasVents != null && {
                                label: "Gas Management",
                                value: slfInfo.numberOfGasVents,
                              },
                              slfInfo.hasWastewaterTreatmentFacility !=
                                null && {
                                label: "WWTF",
                                value: slfInfo.hasWastewaterTreatmentFacility
                                  ? (Array.isArray(
                                      slfInfo.wastewaterTreatmentFacilityType,
                                    )
                                      ? slfInfo.wastewaterTreatmentFacilityType.join(
                                          ", ",
                                        )
                                      : slfInfo.wastewaterTreatmentFacilityType) ||
                                    "Yes"
                                  : "No",
                              },
                              [
                                slfInfo.barangay,
                                slfInfo.lgu,
                                slfInfo.province,
                              ].some(Boolean) && {
                                label: "Location",
                                value: [
                                  slfInfo.barangay,
                                  slfInfo.lgu,
                                  slfInfo.province,
                                ]
                                  .filter(Boolean)
                                  .join(", "),
                              },
                              slfInfo.ownership && {
                                label: "Ownership",
                                value: slfInfo.ownership,
                              },
                              slfInfo.mrfEstablished && {
                                label: "MRF Status",
                                value: slfInfo.mrfEstablished,
                              },
                              slfInfo.eccNo && {
                                label: "ECC No.",
                                value: slfInfo.eccNo,
                              },
                              slfInfo.dischargePermit && {
                                label: "Discharge Permit",
                                value: slfInfo.dischargePermit,
                              },
                              slfInfo.permitToOperate && {
                                label: "Permit to Operate",
                                value: slfInfo.permitToOperate,
                              },
                              slfInfo.hazwasteGenerationId && {
                                label: "Hazwaste Gen. ID",
                                value: slfInfo.hazwasteGenerationId,
                              },
                            ]
                              .filter(Boolean)
                              .map((item, idx) => (
                                <Col xs={24} sm={12} md={8} key={idx}>
                                  <div
                                    style={{
                                      padding: "8px 12px",
                                      borderRadius: 8,
                                      background: "#f8f9fb",
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontSize: 11,
                                        color: "#8c8c8c",
                                        textTransform: "uppercase",
                                        letterSpacing: 0.5,
                                        fontWeight: 600,
                                        marginBottom: 2,
                                      }}
                                    >
                                      {item.label}
                                    </div>
                                    <div
                                      style={{
                                        fontSize: 13,
                                        fontWeight: 600,
                                        color: "#262626",
                                        wordBreak: "break-word",
                                      }}
                                    >
                                      {item.value}
                                    </div>
                                  </div>
                                </Col>
                              ))}
                          </Row>
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div
                  style={{
                    background:
                      "linear-gradient(135deg, #fffbe6 0%, #fff8e1 100%)",
                    border: "1px solid #ffe58f",
                    borderRadius: 10,
                    padding: "16px 20px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <InfoCircleOutlined
                    style={{ color: "#faad14", fontSize: 20 }}
                  />
                  <div>
                    <Text strong style={{ color: "#ad6800", display: "block" }}>
                      Facility Data Unavailable
                    </Text>
                    <Text style={{ color: "#ad6800", fontSize: 12 }}>
                      SLF operational data is currently being processed. Details
                      will appear here once available.
                    </Text>
                  </div>
                </div>
              )}
            </Card>

            {/* Disposal Data Form */}
            <Card className="slf-section" style={{ marginTop: 20 }}>
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                tabBarExtraContent={renderUnitMeasurementControl()}
                items={[
                  {
                    key: "basic-info",
                    label: (
                      <span>
                        <InfoCircleOutlined />{" "}
                        {isMobile ? "Basic Info" : "Basic Information"}
                        <RequiredDot show={missingBasicInfo} />
                      </span>
                    ),
                    children: (
                      <Form
                        form={companyForm}
                        layout="vertical"
                        requiredMark={false}
                        onValuesChange={(changed) => {
                          const vals = companyForm.getFieldsValue();
                          if ("lguCompanyName" in changed) {
                            entryForm.setFieldsValue({
                              lguCompanyName: changed.lguCompanyName,
                            });
                          }
                          if (
                            "companyRegion" in changed ||
                            "companyProvince" in changed ||
                            "companyMunicipality" in changed ||
                            "companyBarangay" in changed
                          ) {
                            const parts = [
                              barangays.find(
                                (b) => b.code === vals.companyBarangay,
                              )?.name,
                              municipalities.find(
                                (m) => m.code === vals.companyMunicipality,
                              )?.name,
                              provinces.find(
                                (p) => p.code === vals.companyProvince,
                              )?.name,
                              regions.find((r) => r.code === vals.companyRegion)
                                ?.name,
                            ].filter(Boolean);
                            entryForm.setFieldsValue({
                              address: parts.join(", "),
                            });
                          }
                        }}
                      >
                        <Divider
                          titlePlacement="left"
                          className="slf-category-divider"
                        >
                          <EnvironmentOutlined /> Company Information
                        </Divider>
                        <Row gutter={[12, 0]}>
                          <Col xs={24} sm={12}>
                            <Form.Item
                              name="lguCompanyName"
                              label="Company Name"
                              rules={[{ required: true, message: "Required" }]}
                            >
                              <Input placeholder="Enter company name" />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Row gutter={[12, 0]}>
                          <Col xs={24} sm={12} md={6}>
                            <Form.Item
                              name="companyRegion"
                              label="Region"
                              rules={[{ required: true, message: "Required" }]}
                            >
                              <Select
                                placeholder="Select Region"
                                showSearch
                                optionFilterProp="children"
                                onChange={(val) => fetchProvinces(val)}
                              >
                                {regions.map((r) => (
                                  <Option key={r.code} value={r.code}>
                                    {r.name}
                                  </Option>
                                ))}
                              </Select>
                            </Form.Item>
                          </Col>
                          <Col xs={24} sm={12} md={6}>
                            <Form.Item
                              name="companyProvince"
                              label="Province"
                              rules={[{ required: true, message: "Required" }]}
                            >
                              <Select
                                placeholder="Select Province"
                                showSearch
                                optionFilterProp="children"
                                onChange={(val) => fetchMunicipalities(val)}
                                disabled={
                                  provinces.length === 0 &&
                                  loadingAddress !== "province"
                                }
                                loading={loadingAddress === "province"}
                                notFoundContent={
                                  loadingAddress === "province" ? (
                                    <Spin size="small" />
                                  ) : undefined
                                }
                              >
                                {provinces.map((p) => (
                                  <Option key={p.code} value={p.code}>
                                    {p.name}
                                  </Option>
                                ))}
                              </Select>
                            </Form.Item>
                          </Col>
                          <Col xs={24} sm={12} md={6}>
                            <Form.Item
                              name="companyMunicipality"
                              label="City/Municipality"
                              rules={[{ required: true, message: "Required" }]}
                            >
                              <Select
                                placeholder="Select City/Municipality"
                                showSearch
                                optionFilterProp="children"
                                onChange={(val) => fetchBarangays(val)}
                                disabled={
                                  municipalities.length === 0 &&
                                  loadingAddress !== "municipality"
                                }
                                loading={loadingAddress === "municipality"}
                                notFoundContent={
                                  loadingAddress === "municipality" ? (
                                    <Spin size="small" />
                                  ) : undefined
                                }
                              >
                                {municipalities.map((m) => (
                                  <Option key={m.code} value={m.code}>
                                    {m.name}
                                  </Option>
                                ))}
                              </Select>
                            </Form.Item>
                          </Col>
                          <Col xs={24} sm={12} md={6}>
                            <Form.Item name="companyBarangay" label="Barangay">
                              <Select
                                placeholder="Select Barangay"
                                showSearch
                                optionFilterProp="children"
                                disabled={
                                  barangays.length === 0 &&
                                  loadingAddress !== "barangay"
                                }
                                loading={loadingAddress === "barangay"}
                                notFoundContent={
                                  loadingAddress === "barangay" ? (
                                    <Spin size="small" />
                                  ) : undefined
                                }
                              >
                                {barangays.map((b) => (
                                  <Option key={b.code} value={b.code}>
                                    {b.name}
                                  </Option>
                                ))}
                              </Select>
                            </Form.Item>
                          </Col>
                        </Row>
                      </Form>
                    ),
                  },
                  {
                    key: "baseline",
                    label: (
                      <span>
                        <DatabaseOutlined />{" "}
                        {isMobile ? "Baseline" : "Baseline Data"}
                        <RequiredDot show={missingBaselineInfo} />
                        {baselineSaved && (
                          <CheckCircleOutlined
                            style={{ color: "#52c41a", marginLeft: 6 }}
                          />
                        )}
                      </span>
                    ),
                    children: (
                      <>
                        {baselineSaved && (
                          <div
                            style={{
                              background: baselineUpdatePending
                                ? "#e6f7ff"
                                : "#fff7e6",
                              border: `1px solid ${baselineUpdatePending ? "#91d5ff" : "#ffe58f"}`,
                              borderRadius: 6,
                              padding: "10px 14px",
                              marginBottom: 16,
                              display: "none",
                              alignItems: isMobile ? "flex-start" : "center",
                              justifyContent: "space-between",
                              flexWrap: "wrap",
                              gap: 8,
                            }}
                          >
                            <div>
                              <InfoCircleOutlined
                                style={{
                                  color: baselineUpdatePending
                                    ? "#1890ff"
                                    : "#faad14",
                                  marginRight: 8,
                                }}
                              />
                              <Text
                                style={{
                                  color: baselineUpdatePending
                                    ? "#096dd9"
                                    : "#ad6800",
                                }}
                              >
                                {baselineUpdatePending
                                  ? "Your baseline update request is pending admin approval. Please wait for a response."
                                  : "Baseline data is locked after your first submission. To request changes, click the button."}
                              </Text>
                            </div>
                            <Space wrap>
                              {!baselineUpdatePending && (
                                <Button
                                  type="primary"
                                  size="small"
                                  icon={<SendOutlined />}
                                  loading={baselineUpdateLoading}
                                  onClick={handleBaselineUpdateRequest}
                                  style={{
                                    background: "#fa8c16",
                                    borderColor: "#fa8c16",
                                  }}
                                >
                                  Request Update
                                </Button>
                              )}
                              {baselineUpdatePending && (
                                <Tag
                                  color="processing"
                                  icon={<ClockCircleOutlined />}
                                >
                                  Awaiting Approval
                                </Tag>
                              )}
                              <Button
                                size="small"
                                icon={<ReloadOutlined />}
                                loading={baselineRefreshLoading}
                                onClick={refreshBaselineStatus}
                              >
                                Refresh
                              </Button>
                            </Space>
                          </div>
                        )}
                        <Form
                          form={baselineForm}
                          layout="vertical"
                          requiredMark={false}
                          disabled={baselineSaved}
                        >
                          {/* ── Unit of Measurement ── */}
                          <div
                            style={{
                              background:
                                "linear-gradient(135deg, #e6f4ff 0%, #f0f5ff 100%)",
                              border: "1px solid #91caff",
                              borderRadius: 10,
                              padding: "12px 16px",
                              marginBottom: 16,
                              marginLeft: "auto",
                              width: "min(100%, 420px)",
                              display: "none",
                              alignItems: "center",
                              gap: 12,
                              flexWrap: "wrap",
                            }}
                          >
                            <div
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 8,
                                background: "#1677ff",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              <DatabaseOutlined
                                style={{ color: "#fff", fontSize: 15 }}
                              />
                            </div>
                            <div style={{ flex: 1, minWidth: 130 }}>
                              <Text
                                strong
                                style={{
                                  fontSize: 12,
                                  color: "#003eb3",
                                  display: "block",
                                }}
                              >
                                Unit of Measurement
                              </Text>
                              <Text type="secondary" style={{ fontSize: 10 }}>
                                Applies to all portal volume fields
                              </Text>
                            </div>
                            <Select
                              value={baselineUnit || "m³"}
                              onChange={handleBaselineUnitChange}
                              disabled={baselineSaved}
                              placeholder="Select unit of measurement"
                              style={{ width: 170 }}
                            >
                              <Option value="m³">m³ (cubic meters)</Option>
                              <Option value="tons">tons</Option>
                            </Select>
                          </div>

                          {/* ── Volume of Waste Accepted ── */}
                          <div
                            style={{
                              background: "#fff",
                              border: "1px solid #e8e8e8",
                              borderRadius: 10,
                              overflow: "hidden",
                              marginBottom: 14,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "10px 16px",
                                background:
                                  "linear-gradient(90deg, #1a3353 0%, #244b7a 100%)",
                              }}
                            >
                              <BarChartOutlined
                                style={{ color: "#fff", fontSize: 13 }}
                              />
                              <Text
                                strong
                                style={{ color: "#fff", fontSize: 13 }}
                              >
                                Volume of Waste Accepted
                              </Text>
                              <Text
                                style={{
                                  color: "rgba(255,255,255,0.55)",
                                  fontSize: 11,
                                  marginLeft: 2,
                                }}
                              >
                                (since start of operation)
                              </Text>
                            </div>
                            <div style={{ padding: "14px 16px 8px" }}>
                              <Row gutter={[12, 0]}>
                                <Col xs={24} sm={14} md={10}>
                                  <Form.Item
                                    name="totalVolumeAccepted"
                                    label="Total Volume Accepted"
                                    required
                                    rules={[
                                      { required: true, message: "Required" },
                                    ]}
                                  >
                                    <InputNumber
                                      placeholder="0.00"
                                      style={{ width: "100%" }}
                                      min={0}
                                      step={0.01}
                                      precision={2}
                                      addonAfter={
                                        baselineUnit === "m³" ? "m³" : "tons"
                                      }
                                      formatter={(v) =>
                                        v
                                          ? Number(v).toLocaleString(
                                              undefined,
                                              {
                                                maximumFractionDigits: 2,
                                              },
                                            )
                                          : ""
                                      }
                                      parser={(v) => v?.replace(/,/g, "")}
                                    />
                                  </Form.Item>
                                </Col>
                              </Row>
                            </div>
                          </div>

                          <Collapse
                            defaultActiveKey={["active", "closed", "haulers"]}
                            bordered={false}
                            style={{
                              background: "transparent",
                              marginBottom: 14,
                            }}
                            items={[
                              {
                                key: "active",
                                label: (
                                  <Space>
                                    <CheckCircleOutlined
                                      style={{ color: "#52c41a" }}
                                    />
                                    <Text strong style={{ color: "#135200" }}>
                                      Active Cells
                                      {activeCellEntries.length > 0
                                        ? ` (${activeCellEntries.length})`
                                        : ""}
                                    </Text>
                                    {activeCellEntries.length > 0 && (
                                      <Text
                                        type="secondary"
                                        style={{ fontSize: 11 }}
                                      >
                                        Total:{" "}
                                        {formatEntryVolumeSummary(
                                          activeCellEntries,
                                          baselineUnit || "m³",
                                        )}
                                      </Text>
                                    )}
                                  </Space>
                                ),
                                extra: !baselineSaved && (
                                  <Button
                                    size="small"
                                    icon={<PlusOutlined />}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingActiveCellKey(null);
                                      setActiveCellDraft({
                                        cellName: "",
                                        wasteType: "Residual",
                                        volume: null,
                                        unit: baselineUnit || "m³",
                                      });
                                      setActiveCellModalOpen(true);
                                    }}
                                  >
                                    Add Entry
                                  </Button>
                                ),
                                children: (
                                  <Table
                                    dataSource={activeCellEntries}
                                    rowKey="key"
                                    size="small"
                                    pagination={false}
                                    style={{ marginBottom: 0 }}
                                    locale={{
                                      emptyText: (
                                        <Text
                                          type="secondary"
                                          style={{ fontSize: 12 }}
                                        >
                                          No entries yet.
                                          {!baselineSaved &&
                                            ' Click "Add Entry" above to add cell data.'}
                                        </Text>
                                      ),
                                    }}
                                    columns={[
                                      {
                                        title: "#",
                                        key: "idx",
                                        width: 42,
                                        render: (_, __, i) => (
                                          <Text
                                            style={{
                                              fontSize: 12,
                                              color: "#8c8c8c",
                                            }}
                                          >
                                            {i + 1}
                                          </Text>
                                        ),
                                      },
                                      {
                                        title: "Cell Name",
                                        dataIndex: "cellName",
                                        key: "cellName",
                                        render: (v) =>
                                          v || (
                                            <Text
                                              type="secondary"
                                              style={{ fontSize: 12 }}
                                            >
                                              Unnamed Cell
                                            </Text>
                                          ),
                                      },
                                      {
                                        title: "Waste Type",
                                        dataIndex: "wasteType",
                                        key: "wasteType",
                                        width: 160,
                                        render: (v) => {
                                          const isHaz = v
                                            ?.toLowerCase()
                                            .includes("hazardous");
                                          const isInert = v === "Inert";
                                          return (
                                            <Tag
                                              color={
                                                isHaz
                                                  ? "red"
                                                  : isInert
                                                    ? "blue"
                                                    : "green"
                                              }
                                              style={{ fontSize: 11 }}
                                            >
                                              {v}
                                            </Tag>
                                          );
                                        },
                                      },
                                      {
                                        title: "Volume",
                                        key: "vol",
                                        width: 140,
                                        render: (_, r) => (
                                          <Text
                                            strong
                                            style={{ color: "#52c41a" }}
                                          >
                                            {r.volume != null
                                              ? `${r.volume.toLocaleString()} ${normalizeUnit(r.unit || baselineUnit || "m³")}`
                                              : "—"}
                                          </Text>
                                        ),
                                      },
                                      !baselineSaved && {
                                        title: "",
                                        key: "act",
                                        width: 72,
                                        render: (_, r) => (
                                          <Space size={0}>
                                            <Button
                                              type="text"
                                              size="small"
                                              icon={<EditOutlined />}
                                              style={{ color: "#1a3353" }}
                                              onClick={() => {
                                                setEditingActiveCellKey(r.key);
                                                setActiveCellDraft({
                                                  cellName: r.cellName,
                                                  wasteType: r.wasteType,
                                                  volume: r.volume,
                                                  unit:
                                                    r.unit ||
                                                    baselineUnit ||
                                                    "m³",
                                                });
                                                setActiveCellModalOpen(true);
                                              }}
                                            />
                                            <Button
                                              type="text"
                                              danger
                                              size="small"
                                              icon={<DeleteOutlined />}
                                              onClick={() =>
                                                setActiveCellEntries((prev) =>
                                                  prev.filter(
                                                    (e) => e.key !== r.key,
                                                  ),
                                                )
                                              }
                                            />
                                          </Space>
                                        ),
                                      },
                                    ].filter(Boolean)}
                                  />
                                ),
                              },
                              {
                                key: "closed",
                                label: (
                                  <Space>
                                    <CloseCircleOutlined
                                      style={{ color: "#722ed1" }}
                                    />
                                    <Text strong style={{ color: "#391085" }}>
                                      Closed Cells
                                      {closedCellEntries.length > 0
                                        ? ` (${closedCellEntries.length})`
                                        : ""}
                                    </Text>
                                    {closedCellEntries.length > 0 && (
                                      <Text
                                        type="secondary"
                                        style={{ fontSize: 11 }}
                                      >
                                        Total:{" "}
                                        {formatEntryVolumeSummary(
                                          closedCellEntries,
                                          baselineUnit || "m³",
                                        )}
                                      </Text>
                                    )}
                                  </Space>
                                ),
                                extra: !baselineSaved && (
                                  <Button
                                    size="small"
                                    icon={<PlusOutlined />}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingClosedCellKey(null);
                                      setClosedCellDraft({
                                        cellName: "",
                                        wasteType: "Residual",
                                        volume: null,
                                        unit: baselineUnit || "m³",
                                      });
                                      setClosedCellModalOpen(true);
                                    }}
                                  >
                                    Add Entry
                                  </Button>
                                ),
                                children: (
                                  <Table
                                    dataSource={closedCellEntries}
                                    rowKey="key"
                                    size="small"
                                    pagination={false}
                                    style={{ marginBottom: 0 }}
                                    locale={{
                                      emptyText: (
                                        <Text
                                          type="secondary"
                                          style={{ fontSize: 12 }}
                                        >
                                          No entries yet.
                                          {!baselineSaved &&
                                            ' Click "Add Entry" above to add cell data.'}
                                        </Text>
                                      ),
                                    }}
                                    columns={[
                                      {
                                        title: "#",
                                        key: "idx",
                                        width: 42,
                                        render: (_, __, i) => (
                                          <Text
                                            style={{
                                              fontSize: 12,
                                              color: "#8c8c8c",
                                            }}
                                          >
                                            {i + 1}
                                          </Text>
                                        ),
                                      },
                                      {
                                        title: "Cell Name",
                                        dataIndex: "cellName",
                                        key: "cellName",
                                        render: (v) =>
                                          v || (
                                            <Text
                                              type="secondary"
                                              style={{ fontSize: 12 }}
                                            >
                                              Unnamed Cell
                                            </Text>
                                          ),
                                      },
                                      {
                                        title: "Waste Type",
                                        dataIndex: "wasteType",
                                        key: "wasteType",
                                        width: 160,
                                        render: (v) => {
                                          const isHaz = v
                                            ?.toLowerCase()
                                            .includes("hazardous");
                                          const isInert = v === "Inert";
                                          return (
                                            <Tag
                                              color={
                                                isHaz
                                                  ? "red"
                                                  : isInert
                                                    ? "purple"
                                                    : "orange"
                                              }
                                              style={{ fontSize: 11 }}
                                            >
                                              {v}
                                            </Tag>
                                          );
                                        },
                                      },
                                      {
                                        title: "Volume",
                                        key: "vol",
                                        width: 140,
                                        render: (_, r) => (
                                          <Text
                                            strong
                                            style={{ color: "#722ed1" }}
                                          >
                                            {r.volume != null
                                              ? `${r.volume.toLocaleString()} ${normalizeUnit(r.unit || baselineUnit || "m³")}`
                                              : "—"}
                                          </Text>
                                        ),
                                      },
                                      !baselineSaved && {
                                        title: "",
                                        key: "act",
                                        width: 72,
                                        render: (_, r) => (
                                          <Space size={0}>
                                            <Button
                                              type="text"
                                              size="small"
                                              icon={<EditOutlined />}
                                              style={{ color: "#1a3353" }}
                                              onClick={() => {
                                                setEditingClosedCellKey(r.key);
                                                setClosedCellDraft({
                                                  cellName: r.cellName,
                                                  wasteType: r.wasteType,
                                                  volume: r.volume,
                                                  unit:
                                                    r.unit ||
                                                    baselineUnit ||
                                                    "m³",
                                                });
                                                setClosedCellModalOpen(true);
                                              }}
                                            />
                                            <Button
                                              type="text"
                                              danger
                                              size="small"
                                              icon={<DeleteOutlined />}
                                              onClick={() =>
                                                setClosedCellEntries((prev) =>
                                                  prev.filter(
                                                    (e) => e.key !== r.key,
                                                  ),
                                                )
                                              }
                                            />
                                          </Space>
                                        ),
                                      },
                                    ].filter(Boolean)}
                                  />
                                ),
                              },
                              {
                                key: "haulers",
                                label: (
                                  <Space>
                                    <TeamOutlined
                                      style={{ color: "#614700" }}
                                    />
                                    <Text strong style={{ color: "#614700" }}>
                                      Accredited Haulers
                                      {haulers.length > 0
                                        ? ` (${haulers.length})`
                                        : ""}
                                    </Text>
                                  </Space>
                                ),
                                children: (
                                  <div>
                                    <div
                                      style={{
                                        marginBottom: 12,
                                        display: "flex",
                                        gap: 8,
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <Button
                                        type="primary"
                                        icon={<PlusOutlined />}
                                        className="slf-primary-btn"
                                        onClick={() => openHaulerModal(null)}
                                        disabled={baselineSaved}
                                      >
                                        Add Hauler
                                      </Button>
                                      <Button
                                        icon={<UploadOutlined />}
                                        onClick={() =>
                                          openUploadGuide("hauler")
                                        }
                                        disabled={baselineSaved}
                                      >
                                        Upload Excel/CSV
                                      </Button>
                                    </div>
                                    <Table
                                      dataSource={haulers}
                                      columns={haulerColumns}
                                      rowKey="key"
                                      size="small"
                                      pagination={false}
                                      scroll={{ x: 700 }}
                                      locale={{
                                        emptyText: (
                                          <Text
                                            type="secondary"
                                            style={{ fontSize: 13 }}
                                          >
                                            No haulers added.
                                          </Text>
                                        ),
                                      }}
                                    />
                                  </div>
                                ),
                              },
                            ]}
                          />

                          {/* ── Save Baseline Update Button (visible when admin approved editing) ── */}
                          {!baselineSaved && (
                            <div
                              style={{
                                marginTop: 24,
                                paddingTop: 16,
                                borderTop: "1px solid #e8e8e8",
                                display: "flex",
                                justifyContent: "flex-end",
                              }}
                            >
                              <Button
                                type="primary"
                                size="large"
                                icon={<SaveOutlined />}
                                loading={baselineSavingLoading}
                                onClick={handleSaveBaselinePortal}
                                style={{
                                  background: "#1a3353",
                                  borderColor: "#1a3353",
                                  paddingLeft: 28,
                                  paddingRight: 28,
                                }}
                              >
                                Save Baseline Update
                              </Button>
                            </div>
                          )}
                        </Form>
                      </>
                    ),
                  },
                  {
                    key: "disposal",
                    label: (
                      <span>
                        <FileTextOutlined />{" "}
                        {isMobile
                          ? "Waste Generator Info"
                          : "Waste Generator Information"}
                        <RequiredDot
                          show={
                            missingDisposalInfo ||
                            missingHazardousCodeTrucks.length > 0
                          }
                        />
                      </span>
                    ),
                    children: (
                      <Form
                        form={entryForm}
                        layout="vertical"
                        requiredMark={false}
                      >
                        <Row gutter={[12, 0]}>
                          <Col xs={24} sm={12} md={8}>
                            <Form.Item
                              name="dateOfDisposal"
                              label={fl("dateOfDisposal", "Date of Disposal")}
                              rules={[
                                {
                                  required: isRequired("dateOfDisposal", true),
                                  message: "Required",
                                },
                              ]}
                            >
                              <DatePicker
                                format="MM/DD/YYYY"
                                style={{ width: "100%" }}
                              />
                            </Form.Item>
                          </Col>
                        </Row>

                        {/* ── Transport & Disposal Information ── */}
                        <div
                          style={{
                            background: "#fff",
                            border: "1px solid #e8e8e8",
                            borderRadius: 10,
                            overflow: "hidden",
                            marginTop: 4,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "10px 16px",
                              background:
                                "linear-gradient(90deg, #1a3353 0%, #244b7a 100%)",
                              flexWrap: "wrap",
                            }}
                          >
                            <div
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 7,
                                background: "rgba(255,255,255,0.15)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              <CarOutlined
                                style={{ color: "#fff", fontSize: 14 }}
                              />
                            </div>
                            <Text
                              strong
                              style={{ color: "#fff", fontSize: 13 }}
                            >
                              Transport &amp; Disposal Information
                            </Text>
                            <Badge
                              count={trucks.length}
                              showZero
                              style={{
                                backgroundColor:
                                  trucks.length > 0
                                    ? "rgba(255,255,255,0.25)"
                                    : "rgba(255,255,255,0.12)",
                                color: "#fff",
                                border: "none",
                                boxShadow: "none",
                              }}
                            />
                            {trucks.length > 0 && (
                              <Text
                                style={{
                                  color: "rgba(255,255,255,0.65)",
                                  fontSize: 11,
                                  marginLeft: 2,
                                }}
                              >
                                · Total:{" "}
                                <strong style={{ color: "#fff" }}>
                                  {trucks
                                    .reduce(
                                      (s, t) => s + (t.actualVolume || 0),
                                      0,
                                    )
                                    .toLocaleString()}
                                </strong>{" "}
                                {trucks[0]?.actualVolumeUnit || "tons"}
                              </Text>
                            )}
                            <Space style={{ marginLeft: "auto" }} wrap>
                              <Button
                                size="small"
                                type="primary"
                                icon={<PlusOutlined />}
                                className="slf-primary-btn"
                                onClick={() => openTruckModal(null)}
                              >
                                Add Entry
                              </Button>
                              <Button
                                size="small"
                                icon={<UploadOutlined />}
                                style={{
                                  background: "rgba(255,255,255,0.12)",
                                  border: "1px solid rgba(255,255,255,0.3)",
                                  color: "#fff",
                                }}
                                onClick={() => openUploadGuide("truck")}
                              >
                                Upload Excel/CSV
                              </Button>
                            </Space>
                          </div>
                          <div
                            style={{
                              padding: trucks.length === 0 ? 0 : "10px 12px",
                            }}
                          >
                            {trucks.length === 0 ? (
                              <div
                                style={{
                                  textAlign: "center",
                                  padding: "28px 16px",
                                  background: "#fafafa",
                                }}
                              >
                                <CarOutlined
                                  style={{
                                    fontSize: 28,
                                    color: "#d9d9d9",
                                    display: "block",
                                    marginBottom: 8,
                                  }}
                                />
                                <Text type="secondary" style={{ fontSize: 13 }}>
                                  No entries added. Click &quot;Add Entry&quot;
                                  to add transport data.
                                </Text>
                              </div>
                            ) : (
                              <Collapse
                                bordered={false}
                                style={{ background: "transparent" }}
                                expandIconPlacement="start"
                                items={trucks.map((t, i) => {
                                  const vehs = t.vehicles || [];
                                  const plateNos =
                                    vehs
                                      .map((v) => v.plateNumber)
                                      .filter(Boolean)
                                      .join(", ") ||
                                    t.plateNumber ||
                                    "—";
                                  const capacities =
                                    vehs.length > 0
                                      ? vehs
                                          .filter((v) => v.capacity != null)
                                          .map(
                                            (v) =>
                                              `${v.capacity} ${(v.capacityUnit || "m³").replace("m3", "m³")}`,
                                          )
                                          .join(", ")
                                      : t.truckCapacity != null
                                        ? `${t.truckCapacity} ${(t.truckCapacityUnit || "m³").replace("m3", "m³")}`
                                        : "—";
                                  const isHaz = t.wasteType
                                    ?.toLowerCase()
                                    .includes("hazardous");
                                  const allClients = vehs.flatMap(
                                    (v) => v.selectedClients || [],
                                  );
                                  return {
                                    key: t.key,
                                    style: {
                                      marginBottom: 6,
                                      borderRadius: 8,
                                      border: "1px solid #e8e8e8",
                                      background: "#fff",
                                      overflow: "hidden",
                                    },
                                    label: (
                                      <div
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 8,
                                          flexWrap: "wrap",
                                          width: "100%",
                                          paddingRight: 4,
                                        }}
                                      >
                                        <div
                                          style={{
                                            width: 22,
                                            height: 22,
                                            borderRadius: 5,
                                            background: "#1a3353",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            flexShrink: 0,
                                          }}
                                        >
                                          <Text
                                            style={{
                                              color: "#fff",
                                              fontSize: 10,
                                              fontWeight: 700,
                                            }}
                                          >
                                            {i + 1}
                                          </Text>
                                        </div>
                                        <Text
                                          strong
                                          style={{
                                            fontSize: 13,
                                            color: "#1a3353",
                                            flexShrink: 0,
                                            maxWidth: 160,
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                          }}
                                        >
                                          {t.disposalTicketNo || (
                                            <Text
                                              type="secondary"
                                              style={{
                                                fontWeight: 400,
                                                fontSize: 12,
                                              }}
                                            >
                                              No Ticket No.
                                            </Text>
                                          )}
                                        </Text>
                                        {t.hauler && (
                                          <Tag
                                            color="blue"
                                            style={{ margin: 0, fontSize: 11 }}
                                          >
                                            {t.hauler}
                                          </Tag>
                                        )}
                                        {t.wasteType && (
                                          <Tag
                                            color={isHaz ? "red" : "green"}
                                            style={{ margin: 0, fontSize: 11 }}
                                          >
                                            {t.wasteType}
                                          </Tag>
                                        )}
                                        {t.actualVolume != null && (
                                          <Tag
                                            color="orange"
                                            style={{
                                              margin: 0,
                                              fontSize: 11,
                                              marginLeft: "auto",
                                            }}
                                          >
                                            {t.actualVolume}{" "}
                                            {t.actualVolumeUnit || "tons"}
                                          </Tag>
                                        )}
                                      </div>
                                    ),
                                    extra: (
                                      <Space
                                        size={0}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <Button
                                          type="text"
                                          size="small"
                                          icon={<EditOutlined />}
                                          onClick={() => openTruckModal(t)}
                                          style={{ color: "#1a3353" }}
                                        />
                                        <Button
                                          type="text"
                                          danger
                                          size="small"
                                          icon={<DeleteOutlined />}
                                          onClick={() => removeTruck(t.key)}
                                        />
                                      </Space>
                                    ),
                                    children: (
                                      <div style={{ padding: "4px 4px 8px" }}>
                                        <Row gutter={[10, 8]}>
                                          {t.lguCompanyName && (
                                            <Col xs={24} sm={12} md={8}>
                                              <div
                                                style={{
                                                  background: "#f8faff",
                                                  borderRadius: 6,
                                                  padding: "6px 10px",
                                                }}
                                              >
                                                <div
                                                  style={{
                                                    fontSize: 10,
                                                    color: "#8c8c8c",
                                                    textTransform: "uppercase",
                                                    letterSpacing: 0.5,
                                                    fontWeight: 600,
                                                  }}
                                                >
                                                  LGU / Company
                                                </div>
                                                <div
                                                  style={{
                                                    fontSize: 13,
                                                    fontWeight: 600,
                                                    color: "#262626",
                                                    marginTop: 2,
                                                  }}
                                                >
                                                  {t.lguCompanyName}
                                                </div>
                                              </div>
                                            </Col>
                                          )}
                                          {t.companyType && (
                                            <Col xs={12} sm={6} md={4}>
                                              <div
                                                style={{
                                                  background: "#f8faff",
                                                  borderRadius: 6,
                                                  padding: "6px 10px",
                                                }}
                                              >
                                                <div
                                                  style={{
                                                    fontSize: 10,
                                                    color: "#8c8c8c",
                                                    textTransform: "uppercase",
                                                    letterSpacing: 0.5,
                                                    fontWeight: 600,
                                                  }}
                                                >
                                                  Type
                                                </div>
                                                <Tag
                                                  color={
                                                    t.companyType === "LGU"
                                                      ? "blue"
                                                      : "green"
                                                  }
                                                  style={{
                                                    margin: "4px 0 0",
                                                    fontWeight: 600,
                                                  }}
                                                >
                                                  {t.companyType}
                                                </Tag>
                                              </div>
                                            </Col>
                                          )}
                                          <Col xs={12} sm={6} md={4}>
                                            <div
                                              style={{
                                                background: "#f8faff",
                                                borderRadius: 6,
                                                padding: "6px 10px",
                                              }}
                                            >
                                              <div
                                                style={{
                                                  fontSize: 10,
                                                  color: "#8c8c8c",
                                                  textTransform: "uppercase",
                                                  letterSpacing: 0.5,
                                                  fontWeight: 600,
                                                }}
                                              >
                                                Plate No.
                                              </div>
                                              <div
                                                style={{
                                                  fontSize: 12,
                                                  fontWeight: 600,
                                                  color: "#262626",
                                                  marginTop: 2,
                                                }}
                                              >
                                                {plateNos}
                                              </div>
                                            </div>
                                          </Col>
                                          <Col xs={12} sm={6} md={4}>
                                            <div
                                              style={{
                                                background: "#f8faff",
                                                borderRadius: 6,
                                                padding: "6px 10px",
                                              }}
                                            >
                                              <div
                                                style={{
                                                  fontSize: 10,
                                                  color: "#8c8c8c",
                                                  textTransform: "uppercase",
                                                  letterSpacing: 0.5,
                                                  fontWeight: 600,
                                                }}
                                              >
                                                Capacity
                                              </div>
                                              <div
                                                style={{
                                                  fontSize: 12,
                                                  fontWeight: 600,
                                                  color: "#262626",
                                                  marginTop: 2,
                                                }}
                                              >
                                                {capacities}
                                              </div>
                                            </div>
                                          </Col>
                                          <Col xs={12} sm={6} md={4}>
                                            <div
                                              style={{
                                                background: "#fff7e6",
                                                borderRadius: 6,
                                                padding: "6px 10px",
                                                border: "1px solid #ffe7ba",
                                              }}
                                            >
                                              <div
                                                style={{
                                                  fontSize: 10,
                                                  color: "#8c8c8c",
                                                  textTransform: "uppercase",
                                                  letterSpacing: 0.5,
                                                  fontWeight: 600,
                                                }}
                                              >
                                                Actual Volume
                                              </div>
                                              <div
                                                style={{
                                                  fontSize: 14,
                                                  fontWeight: 700,
                                                  color: "#fa8c16",
                                                  marginTop: 2,
                                                }}
                                              >
                                                {t.actualVolume != null
                                                  ? `${t.actualVolume} ${t.actualVolumeUnit || "tons"}`
                                                  : "—"}
                                              </div>
                                            </div>
                                          </Col>
                                          {isHaz &&
                                            t.hazWasteCode &&
                                            (Array.isArray(t.hazWasteCode)
                                              ? t.hazWasteCode
                                              : [t.hazWasteCode]
                                            ).length > 0 && (
                                              <Col xs={24}>
                                                <div
                                                  style={{
                                                    background: "#fff1f0",
                                                    borderRadius: 6,
                                                    padding: "6px 10px",
                                                    border: "1px solid #ffa39e",
                                                  }}
                                                >
                                                  <div
                                                    style={{
                                                      fontSize: 10,
                                                      color: "#8c8c8c",
                                                      textTransform:
                                                        "uppercase",
                                                      letterSpacing: 0.5,
                                                      fontWeight: 600,
                                                      marginBottom: 4,
                                                    }}
                                                  >
                                                    Haz. Waste Code(s)
                                                  </div>
                                                  {(Array.isArray(
                                                    t.hazWasteCode,
                                                  )
                                                    ? t.hazWasteCode
                                                    : [t.hazWasteCode]
                                                  ).map((code) => (
                                                    <Tag
                                                      key={code}
                                                      color="red"
                                                      style={{
                                                        fontSize: 11,
                                                        marginBottom: 2,
                                                      }}
                                                    >
                                                      {code}
                                                    </Tag>
                                                  ))}
                                                </div>
                                              </Col>
                                            )}
                                          {allClients.length > 0 && (
                                            <Col xs={24}>
                                              <div
                                                style={{
                                                  background: "#f6ffed",
                                                  borderRadius: 6,
                                                  padding: "6px 10px",
                                                  border: "1px solid #b7eb8f",
                                                }}
                                              >
                                                <div
                                                  style={{
                                                    fontSize: 10,
                                                    color: "#8c8c8c",
                                                    textTransform: "uppercase",
                                                    letterSpacing: 0.5,
                                                    fontWeight: 600,
                                                    marginBottom: 4,
                                                  }}
                                                >
                                                  Clients ({allClients.length})
                                                </div>
                                                {allClients.map((c, ci) => {
                                                  const name =
                                                    typeof c === "string"
                                                      ? c
                                                      : c.clientName;
                                                  const type =
                                                    typeof c === "string"
                                                      ? null
                                                      : c.clientType;
                                                  return (
                                                    <Tag
                                                      key={ci}
                                                      color={
                                                        type === "LGU"
                                                          ? "blue"
                                                          : "green"
                                                      }
                                                      style={{
                                                        fontSize: 11,
                                                        marginBottom: 2,
                                                      }}
                                                    >
                                                      {name}
                                                      {type ? ` (${type})` : ""}
                                                    </Tag>
                                                  );
                                                })}
                                              </div>
                                            </Col>
                                          )}
                                        </Row>
                                      </div>
                                    ),
                                  };
                                })}
                              />
                            )}
                          </div>
                        </div>
                      </Form>
                    ),
                  },
                ]}
              />
            </Card>
          </Col>
          <Col xs={24} xl={5}>
            <Card
              className="slf-section"
              title={
                <Space>
                  <QuestionCircleOutlined style={{ color: "#1a3353" }} />
                  <Text strong style={{ color: "#1a3353" }}>
                    Encoding Guide
                  </Text>
                </Space>
              }
              style={{ position: isMobile ? "static" : "sticky", top: 76 }}
            >
              <Collapse
                size="small"
                bordered={false}
                style={{ background: "transparent" }}
                items={[
                  {
                    key: "baseline",
                    label: (
                      <Text strong style={{ fontSize: 12 }}>
                        Baseline Data
                      </Text>
                    ),
                    children: renderGuideItems(
                      [
                        "Select the unit that matches your encoded volume before adding cell entries.",
                        "Encode total volume accepted since start of operation.",
                        "Add active and closed cell entries with the correct waste type and unit.",
                        "Add accredited haulers and vehicle/client details before the first submission.",
                      ],
                      "#1677ff",
                    ),
                  },
                  {
                    key: "generator",
                    label: (
                      <Text strong style={{ fontSize: 12 }}>
                        Waste Generator Info
                      </Text>
                    ),
                    children: renderGuideItems(
                      [
                        "Choose the disposal date and add each transport entry.",
                        "Use Treated Hazardous Waste only for treated hazardous loads.",
                        "Hazardous Waste Code is required for every Treated Hazardous Waste entry.",
                        "Review truck plate, hauler, capacity, actual volume, and unit before submitting.",
                      ],
                      "#52c41a",
                    ),
                  },
                  {
                    key: "notes",
                    label: (
                      <Text strong style={{ fontSize: 12 }}>
                        Other Notes
                      </Text>
                    ),
                    children: renderGuideItems(
                      [
                        "Baseline data locks after submission unless an admin approves an update request.",
                        "Use My Requests to track update and edit requests.",
                        "Use Submission History to review submitted entries and status changes.",
                      ],
                      "#fa8c16",
                    ),
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>
      </div>
    );
  };

  // ── My Requests Content ──
  const REQUEST_TYPE_MAP = {
    baseline_update_request: {
      label: "Baseline Update Request",
      color: "blue",
    },
    baseline_update_approved: {
      label: "Baseline Update Approved",
      color: "green",
    },
    submission_edit_request: { label: "Edit Request", color: "blue" },
    submission_edit_approved: { label: "Edit Approved", color: "green" },
    submission_edit_rejected: { label: "Edit Rejected", color: "red" },
    support_ticket: { label: "Support Ticket", color: "purple" },
    support_ticket_reply: { label: "Support Reply", color: "cyan" },
  };

  const renderRequests = () => (
    <div style={{ maxWidth: 1680, margin: "0 auto" }}>
      <Card
        className="slf-section"
        title={
          <Space>
            <AuditOutlined style={{ color: "#1a3353" }} />
            <span>My Requests &amp; Amendments</span>
          </Space>
        }
      >
        <Table
          dataSource={myRequests}
          rowKey={(r) => r._id}
          loading={myRequestsLoading}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          locale={{ emptyText: "No requests found" }}
          columns={[
            {
              title: "Date / Time",
              dataIndex: "createdAt",
              key: "date",
              width: 180,
              sorter: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
              defaultSortOrder: "descend",
              render: (v) =>
                v
                  ? new Date(v).toLocaleString("en-PH", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })
                  : "—",
            },
            {
              title: "Type",
              dataIndex: "type",
              key: "type",
              width: 200,
              filters: Object.entries(REQUEST_TYPE_MAP).map(
                ([val, { label }]) => ({
                  text: label,
                  value: val,
                }),
              ),
              onFilter: (value, record) => record.type === value,
              render: (t) => {
                const cfg = REQUEST_TYPE_MAP[t] || {
                  label: t,
                  color: "default",
                };
                return <Tag color={cfg.color}>{cfg.label}</Tag>;
              },
            },
            {
              title: "Description",
              dataIndex: "description",
              key: "description",
              ellipsis: true,
            },
            {
              title: "Status",
              dataIndex: "type",
              key: "status",
              width: 120,
              render: (type, record) => {
                const approved = type.includes("approved");
                const rejected =
                  type.includes("rejected") ||
                  record.meta?.action === "rejected";
                if (approved) return <Tag color="green">APPROVED</Tag>;
                if (rejected) return <Tag color="red">REJECTED</Tag>;
                // For request types, check if a resolution exists in the list
                if (type.includes("request")) {
                  const company = record.companyName || record.meta?.slfName;
                  const resolutionType = type.replace("_request", "");
                  const resolved = myRequests.find(
                    (t) =>
                      t._id !== record._id &&
                      new Date(t.createdAt) >= new Date(record.createdAt) &&
                      (t.companyName === company ||
                        t.meta?.slfName === company) &&
                      (t.type === `${resolutionType}_approved` ||
                        t.type === `${resolutionType}_rejected` ||
                        t.meta?.action === "rejected"),
                  );
                  if (resolved) {
                    if (resolved.type.includes("approved"))
                      return <Tag color="green">APPROVED</Tag>;
                    if (
                      resolved.type.includes("rejected") ||
                      resolved.meta?.action === "rejected"
                    )
                      return <Tag color="red">REJECTED</Tag>;
                  }
                  return <Tag color="orange">PENDING</Tag>;
                }
                return <Tag color="blue">INFO</Tag>;
              },
            },
          ]}
        />
      </Card>
    </div>
  );

  // ── History Content ──
  const renderHistory = () => (
    <div style={{ maxWidth: 1680, margin: "0 auto" }}>
      <Card
        className="slf-section"
        title={
          <Space>
            <HistoryOutlined style={{ color: "#1a3353" }} />
            <Text strong style={{ fontSize: 16, color: "#1a3353" }}>
              Submission History
            </Text>
          </Space>
        }
        extra={
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => fetchSubmissions()}
          >
            Refresh
          </Button>
        }
      >
        <Table
          dataSource={submissions}
          columns={historyColumns}
          rowKey="_id"
          loading={loadingSubmissions}
          size="small"
          pagination={{ pageSize: 15 }}
          scroll={{ x: 1100 }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No submissions yet"
              />
            ),
          }}
        />
      </Card>
    </div>
  );

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {errorCard}
      {/* Desktop Sider */}
      {!isMobile && (
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={220}
          collapsedWidth={64}
          className="portal-sider"
          style={{
            background: "linear-gradient(180deg, #0e1e35 0%, #1a3353 100%)",
            overflow: "auto",
            height: "100vh",
            position: "fixed",
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: 10,
          }}
        >
          {siderContent}
        </Sider>
      )}

      {/* Mobile Drawer */}
      {isMobile && (
        <Drawer
          placement="left"
          open={mobileDrawer}
          onClose={() => setMobileDrawer(false)}
          size={240}
          styles={{
            body: {
              padding: 0,
              background: "linear-gradient(180deg, #0e1e35 0%, #1a3353 100%)",
            },
          }}
          closable={false}
        >
          {siderContent}
        </Drawer>
      )}

      <Layout
        style={{
          marginLeft: isMobile ? 0 : collapsed ? 64 : 220,
          transition: "margin-left 0.2s",
        }}
      >
        {/* Header */}
        <Header
          className="portal-header"
          style={{
            background: "#fff",
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
            position: "sticky",
            top: 0,
            zIndex: 9,
            height: 56,
          }}
        >
          <Space>
            {isMobile && (
              <Button
                type="text"
                icon={<MenuOutlined />}
                onClick={() => setMobileDrawer(true)}
              />
            )}
            <Text strong style={{ color: "#1a3353", fontSize: 16 }}>
              SLF Generators Portal
            </Text>
          </Space>
          <Space size={8}>
            <Popover
              trigger="click"
              placement="bottomRight"
              open={notificationPanelOpen}
              onOpenChange={setNotificationPanelOpen}
              content={portalNotificationPanel}
            >
              <Badge count={portalNotificationCounts.total} size="small">
                <Button
                  type={
                    portalNotificationCounts.total > 0 ? "primary" : "default"
                  }
                  shape="circle"
                  icon={<BellOutlined />}
                  aria-label="Open notifications"
                />
              </Badge>
            </Popover>
            <Tooltip title="Messages from admin">
              <Badge count={portalNotificationCounts.messages} size="small">
                <Button
                  type={
                    portalNotificationCounts.messages > 0
                      ? "primary"
                      : "default"
                  }
                  shape="circle"
                  icon={<MessageOutlined />}
                  onClick={() => {
                    setMessageDrawerOpen(true);
                    if (supportTickets.length === 0) fetchSupportTickets();
                    markPortalNotificationsRead("messages");
                  }}
                />
              </Badge>
            </Tooltip>
            <Tooltip title="Support tickets">
              <Badge count={portalNotificationCounts.support} size="small">
                <Button
                  shape="circle"
                  icon={<CustomerServiceOutlined />}
                  onClick={() => {
                    setSupportDrawerOpen(true);
                    setSupportTab("my-tickets");
                    if (supportTickets.length === 0) fetchSupportTickets();
                    markPortalNotificationsRead("support");
                  }}
                />
              </Badge>
            </Tooltip>
            <Dropdown
              menu={{
                items: userMenuItems,
                onClick: ({ key }) => {
                  if (key === "profile") setProfileModalOpen(true);
                  if (key === "logout") handleLogout();
                },
              }}
              trigger={["click"]}
            >
              <Space style={{ cursor: "pointer" }}>
                <Avatar
                  size="small"
                  style={{
                    background: "linear-gradient(135deg, #1a3353, #2d5f8a)",
                  }}
                >
                  {portalUser?.firstName?.[0]?.toUpperCase()}
                </Avatar>
                {!isMobile && (
                  <Text style={{ color: "#1a3353", fontWeight: 500 }}>
                    {userDisplay}
                  </Text>
                )}
              </Space>
            </Dropdown>
          </Space>
        </Header>

        {/* Content */}
        <Content
          style={{
            padding: isMobile ? "12px 6px" : "24px 24px",
            background: "#f0f2f5",
            minHeight: "calc(100vh - 56px - 52px)",
          }}
        >
          {!isOnline && (
            <div
              style={{
                background: "linear-gradient(90deg, #7c3a10 0%, #b45309 100%)",
                color: "#fff",
                padding: "8px 16px",
                borderRadius: 8,
                marginBottom: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              <WifiOutlined />
              You are currently offline. Some features may be unavailable. Data
              will be sent once your connection is restored.
            </div>
          )}
          {portalAnnouncement && !announcementDismissed && (
            <Collapse
              size="small"
              style={{
                marginBottom: 12,
                borderRadius: 8,
              }}
              items={[
                {
                  key: "announcement",
                  label: (
                    <Space wrap>
                      <Text strong>
                        {portalAnnouncement.portalAnnouncementTitle ||
                          "SLF Portal Announcement"}
                      </Text>
                      <Tag color="blue">Announcement</Tag>
                    </Space>
                  ),
                  extra:
                    portalAnnouncement.portalAnnouncementDismissible !==
                    false ? (
                      <Button
                        size="small"
                        type="text"
                        onClick={(event) => {
                          event.stopPropagation();
                          setAnnouncementDismissed(true);
                        }}
                      >
                        Dismiss
                      </Button>
                    ) : null,
                  children: (
                    <Alert
                      type={portalAnnouncement.portalAnnouncementType || "info"}
                      showIcon
                      message={null}
                      description={
                        <Space
                          direction="vertical"
                          size={8}
                          style={{ width: "100%" }}
                        >
                          <div style={{ whiteSpace: "pre-wrap" }}>
                            {portalAnnouncement.portalAnnouncementMessage}
                          </div>
                        </Space>
                      }
                    />
                  ),
                },
              ]}
            />
          )}
          {(portalNotificationCounts.messages > 0 ||
            portalNotificationCounts.support > 0) && (
            <Card
              size="small"
              style={{
                marginBottom: 12,
                borderRadius: 8,
                borderColor: "#91caff",
                background: "#e6f4ff",
              }}
              bodyStyle={{ padding: "10px 14px" }}
            >
              <Space
                wrap
                style={{ width: "100%", justifyContent: "space-between" }}
              >
                <Space>
                  <BellOutlined style={{ color: "#1677ff" }} />
                  <Text strong>You have unread admin updates</Text>
                  {portalNotificationCounts.messages > 0 && (
                    <Tag color="blue">
                      {portalNotificationCounts.messages} message(s)
                    </Tag>
                  )}
                  {portalNotificationCounts.support > 0 && (
                    <Tag color="purple">
                      {portalNotificationCounts.support} ticket update(s)
                    </Tag>
                  )}
                </Space>
                <Space>
                  {portalNotificationCounts.messages > 0 && (
                    <Button
                      size="small"
                      type="primary"
                      icon={<MessageOutlined />}
                      onClick={() => {
                        setMessageDrawerOpen(true);
                        if (supportTickets.length === 0) fetchSupportTickets();
                        markPortalNotificationsRead("messages");
                      }}
                    >
                      Open Messages
                    </Button>
                  )}
                  {portalNotificationCounts.support > 0 && (
                    <Button
                      size="small"
                      icon={<CustomerServiceOutlined />}
                      onClick={() => {
                        setSupportDrawerOpen(true);
                        setSupportTab("my-tickets");
                        if (supportTickets.length === 0) fetchSupportTickets();
                        markPortalNotificationsRead("support");
                      }}
                    >
                      View Tickets
                    </Button>
                  )}
                </Space>
              </Space>
            </Card>
          )}
          {activeMenu === "overview" && renderOverview()}
          {activeMenu === "data-entry" && renderDataEntry()}
          {activeMenu === "history" && renderHistory()}
          {activeMenu === "requests" && renderRequests()}
        </Content>

        {/* Footer */}
        <div className="slf-footer">
          <Text className="slf-footer-text">
            &copy; 2026 EMBR3 — Ecological Solid Waste Management Pipeline. All
            rights reserved.
          </Text>
        </div>

        <SLFPortalModals
          entryForm={entryForm}
          baselineForm={baselineForm}
          companyForm={companyForm}
          haulerModalOpen={haulerModalOpen}
          setHaulerModalOpen={setHaulerModalOpen}
          haulerDraft={haulerDraft}
          setHaulerDraft={setHaulerDraft}
          editingHaulerKey={editingHaulerKey}
          setEditingHaulerKey={setEditingHaulerKey}
          haulerErrors={haulerErrors}
          setHaulerErrors={setHaulerErrors}
          haulerProvinces={haulerProvinces}
          setHaulerProvinces={setHaulerProvinces}
          haulerCities={haulerCities}
          setHaulerCities={setHaulerCities}
          haulerBarangayList={haulerBarangayList}
          setHaulerBarangayList={setHaulerBarangayList}
          loadingHaulerAddress={loadingHaulerAddress}
          setLoadingHaulerAddress={setLoadingHaulerAddress}
          fetchHaulerProvinces={fetchHaulerProvinces}
          fetchHaulerCities={fetchHaulerCities}
          fetchHaulerBarangays={fetchHaulerBarangays}
          clientModalOpen={clientModalOpen}
          setClientModalOpen={setClientModalOpen}
          editingClientKey={editingClientKey}
          setEditingClientKey={setEditingClientKey}
          clientDraft={clientDraft}
          setClientDraft={setClientDraft}
          clientProvinces={clientProvinces}
          setClientProvinces={setClientProvinces}
          clientMunicipalities={clientMunicipalities}
          setClientMunicipalities={setClientMunicipalities}
          loadingClientAddress={loadingClientAddress}
          setLoadingClientAddress={setLoadingClientAddress}
          truckModalOpen={truckModalOpen}
          setTruckModalOpen={setTruckModalOpen}
          truckDraft={truckDraft}
          setTruckDraft={setTruckDraft}
          editingTruckKey={editingTruckKey}
          setEditingTruckKey={setEditingTruckKey}
          truckErrors={truckErrors}
          setTruckErrors={setTruckErrors}
          historyDetailModal={historyDetailModal}
          setHistoryDetailModal={setHistoryDetailModal}
          reviewModalOpen={reviewModalOpen}
          setReviewModalOpen={setReviewModalOpen}
          revertModalOpen={revertModalOpen}
          setRevertModalOpen={setRevertModalOpen}
          revertRecord={revertRecord}
          setRevertRecord={setRevertRecord}
          revertReason={revertReason}
          setRevertReason={setRevertReason}
          revertLoading={revertLoading}
          loading={loading}
          profileModalOpen={profileModalOpen}
          setProfileModalOpen={setProfileModalOpen}
          supportDrawerOpen={supportDrawerOpen}
          setSupportDrawerOpen={setSupportDrawerOpen}
          messageDrawerOpen={messageDrawerOpen}
          setMessageDrawerOpen={setMessageDrawerOpen}
          supportTab={supportTab}
          setSupportTab={setSupportTab}
          supportTickets={supportTickets}
          portalNotificationCounts={portalNotificationCounts}
          markPortalNotificationsRead={markPortalNotificationsRead}
          supportLoading={supportLoading}
          supportSubmitting={supportSubmitting}
          fetchSupportTickets={fetchSupportTickets}
          faqActiveKey={faqActiveKey}
          setFaqActiveKey={setFaqActiveKey}
          supportDetailModal={supportDetailModal}
          setSupportDetailModal={setSupportDetailModal}
          supportReplyText={supportReplyText}
          setSupportReplyText={setSupportReplyText}
          uploadModalOpen={uploadModalOpen}
          setUploadModalOpen={setUploadModalOpen}
          uploadType={uploadType}
          setUploadType={setUploadType}
          uploadGuideOpen={uploadGuideOpen}
          setUploadGuideOpen={setUploadGuideOpen}
          uploadGuideType={uploadGuideType}
          setUploadGuideType={setUploadGuideType}
          uploadPreviewData={uploadPreviewData}
          uploadPreviewColumns={uploadPreviewColumns}
          uploadMissingColumns={uploadMissingColumns}
          setUploadPreviewData={setUploadPreviewData}
          setUploadPreviewColumns={setUploadPreviewColumns}
          setUploadMissingColumns={setUploadMissingColumns}
          activeCellModalOpen={activeCellModalOpen}
          setActiveCellModalOpen={setActiveCellModalOpen}
          activeCellDraft={activeCellDraft}
          setActiveCellDraft={setActiveCellDraft}
          editingActiveCellKey={editingActiveCellKey}
          setEditingActiveCellKey={setEditingActiveCellKey}
          closedCellModalOpen={closedCellModalOpen}
          setClosedCellModalOpen={setClosedCellModalOpen}
          closedCellDraft={closedCellDraft}
          setClosedCellDraft={setClosedCellDraft}
          editingClosedCellKey={editingClosedCellKey}
          setEditingClosedCellKey={setEditingClosedCellKey}
          haulerDeleteModal={haulerDeleteModal}
          setHaulerDeleteModal={setHaulerDeleteModal}
          haulerDeleteReason={haulerDeleteReason}
          setHaulerDeleteReason={setHaulerDeleteReason}
          haulerDeleteFile={haulerDeleteFile}
          setHaulerDeleteFile={setHaulerDeleteFile}
          haulerDeleteLoading={haulerDeleteLoading}
          setHaulerDeleteLoading={setHaulerDeleteLoading}
          leachateModalOpen={leachateModalOpen}
          setLeachateModalOpen={setLeachateModalOpen}
          leachateDetails={leachateDetails}
          setLeachateDetails={setLeachateDetails}
          gasVentModalOpen={gasVentModalOpen}
          setGasVentModalOpen={setGasVentModalOpen}
          gasVentDetails={gasVentDetails}
          setGasVentDetails={setGasVentDetails}
          trashSlideModalOpen={trashSlideModalOpen}
          setTrashSlideModalOpen={setTrashSlideModalOpen}
          trashSlideDetails={trashSlideDetails}
          setTrashSlideDetails={setTrashSlideDetails}
          firePrevModalOpen={firePrevModalOpen}
          setFirePrevModalOpen={setFirePrevModalOpen}
          firePrevDetails={firePrevDetails}
          setFirePrevDetails={setFirePrevDetails}
          facilityMgmtSaving={facilityMgmtSaving}
          wasteReceivedModalOpen={wasteReceivedModalOpen}
          setWasteReceivedModalOpen={setWasteReceivedModalOpen}
          wasteReceivedData={wasteReceivedData}
          wasteReceivedLoading={wasteReceivedLoading}
          activeCellEntries={activeCellEntries}
          activeCellOptions={activeCellOptions}
          closedCellEntries={closedCellEntries}
          haulers={haulers}
          trucks={trucks}
          baselineUnit={baselineUnit}
          baselineSaved={baselineSaved}
          submissions={submissions}
          portalUser={portalUser}
          portalCredentialSelfServiceEnabled={portalUser?.allowCredentialSelfService === true}
          onCredentialUpdated={handleLogout}
          activeSlfId={activeSlfId}
          activeSlfName={activeSlfName}
          slfInfo={slfInfo}
          regions={regions}
          provinces={provinces}
          municipalities={municipalities}
          barangays={barangays}
          extraTransportFields={extraTransportFields}
          acceptsHazardousWaste={acceptsHazardousWaste}
          hazWasteCodes={hazWasteCodes}
          isMobile={isMobile}
          handleSaveHauler={handleSaveHauler}
          updateHaulerDraft={updateHaulerDraft}
          updateHaulerDraftAddr={updateHaulerDraftAddr}
          openHaulerModal={openHaulerModal}
          handleSaveClient={handleSaveClient}
          handleSaveTruck={handleSaveTruck}
          updateTruckDraft={updateTruckDraft}
          updateVehicle={updateVehicle}
          openRevertModal={openRevertModal}
          handleRequestRevert={handleRequestRevert}
          handleConfirmSubmit={handleConfirmSubmit}
          handleReviewOpen={handleReviewOpen}
          handleSubmitTicket={handleSubmitTicket}
          handleSupportReply={handleSupportReply}
          handleSaveActiveCellEntry={handleSaveActiveCellEntry}
          handleSaveClosedCellEntry={handleSaveClosedCellEntry}
          handleConfirmUpload={handleConfirmUpload}
          proceedToFilePicker={proceedToFilePicker}
          updateUploadCell={updateUploadCell}
          handleOpenWasteReceived={handleOpenWasteReceived}
          handleSaveFacilityDetails={handleSaveFacilityDetails}
          handleEditReverted={handleEditReverted}
          handleResubmitReverted={handleResubmitReverted}
          renderStatusTag={renderStatusTag}
          fl={fl}
          isRequired={isRequired}
          opts={opts}
          fieldErr={fieldErr}
          resubmitComment={resubmitComment}
          setResubmitComment={setResubmitComment}
          editingRevertedId={editingRevertedId}
          setEditingRevertedId={setEditingRevertedId}
        />
      </Layout>
    </Layout>
  );
}
