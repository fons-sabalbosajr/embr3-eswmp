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
import api from "../api";
import { useErrorCard } from "../utils/ErrorHandler";
import secureStorage from "../utils/secureStorage";
import { connectSocket, disconnectSocket } from "../utils/socket";
import embLogo from "../assets/emblogo.svg";
import "./SLFPortal.css";

const { Text } = Typography;
const { Option } = Select;
const { Header, Sider, Content } = Layout;
const { useBreakpoint } = Grid;
const { TextArea } = Input;

const EMPTY_TRUCK = {
  disposalTicketNo: "",
  hauler: "",
  plateNumber: "",
  truckCapacity: null,
  truckCapacityUnit: "m³",
  vehicles: [],
  actualVolume: null,
  actualVolumeUnit: "m³",
  wasteType: undefined,
  hazWasteCode: [],
};

const KNOWN_TRANSPORT_KEYS = new Set([
  "disposalTicketNo", "hauler", "plateNumber", "truckCapacity", "actualVolume", "wasteType", "hazWasteCode",
]);

const EMPTY_VEHICLE = {
  plateNumber: "",
  vehicleType: "",
  capacity: null,
  capacityUnit: "m³",
};

const EMPTY_HAULER = {
  haulerName: "",
  numberOfTrucks: null,
  officeAddress: "",
  officeRegion: "",
  officeProvince: "",
  officeCity: "",
  officeBarangay: "",
  vehicles: [],
  privateSectorClients: [],
};

// Retry helper: calls fn up to `retries` times with exponential backoff.
// Skips retries when browser is offline. Respects AbortSignal.
function withRetry(fn, { retries = 3, baseDelay = 1000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
      fn()
        .then(resolve)
        .catch((err) => {
          if (err?.name === "AbortError" || err?.code === "ERR_CANCELED") return reject(err);
          if (n >= retries || !navigator.onLine) return reject(err);
          setTimeout(() => attempt(n + 1), baseDelay * 2 ** n);
        });
    };
    attempt(0);
  });
}

export default function SLFPortal() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const { showError, card: errorCard } = useErrorCard();
  const [portalUser, setPortalUser] = useState(null);
  const [activeMenu, setActiveMenu] = useState("data-entry");
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
  const [baselineSavingLoading, setBaselineSavingLoading] = useState(false);
  const [slfInfo, setSlfInfo] = useState(null);
  const [slfInfoLoading, setSlfInfoLoading] = useState(false);
  const [slfCardExpanded, setSlfCardExpanded] = useState(false);
  const [selectedSlfIdx, setSelectedSlfIdx] = useState(0); // for multi-SLF users
  const [fieldLabels, setFieldLabels] = useState({});
  const [hazWasteCodes, setHazWasteCodes] = useState(["K301", "K302", "K303", "M501"]);
  const [historyDetailModal, setHistoryDetailModal] = useState(null);
  const [revertModalOpen, setRevertModalOpen] = useState(false);
  const [revertRecord, setRevertRecord] = useState(null);
  const [revertReason, setRevertReason] = useState("");
  const [revertLoading, setRevertLoading] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  // Active cell entries (table-based)
  const [activeCellEntries, setActiveCellEntries] = useState([]);
  const [activeCellModalOpen, setActiveCellModalOpen] = useState(false);
  const [activeCellDraft, setActiveCellDraft] = useState({ cellName: "", wasteType: "Residual", volume: null });
  const [editingActiveCellKey, setEditingActiveCellKey] = useState(null);
  // Closed cell entries (table-based)
  const [closedCellEntries, setClosedCellEntries] = useState([]);
  const [closedCellModalOpen, setClosedCellModalOpen] = useState(false);
  const [closedCellDraft, setClosedCellDraft] = useState({ cellName: "", wasteType: "Residual", volume: null });
  const [editingClosedCellKey, setEditingClosedCellKey] = useState(null);
  // Hauler delete request modal
  const [haulerDeleteModal, setHaulerDeleteModal] = useState({ open: false, hauler: null });
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
  const [clientDraft, setClientDraft] = useState({ clientName: "", clientType: "Private", region: "", province: "", municipality: "" });
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
  const [baselineUnit, setBaselineUnit] = useState(null);
  const [acceptsHazardousWaste, setAcceptsHazardousWaste] = useState(false);
  // Support ticket states
  const [supportDrawerOpen, setSupportDrawerOpen] = useState(false);
  const [supportTab, setSupportTab] = useState("new");
  const [supportTickets, setSupportTickets] = useState([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportDetailModal, setSupportDetailModal] = useState(null);
  const [supportReplyText, setSupportReplyText] = useState("");
  // Excel/CSV upload states
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadType, setUploadType] = useState("truck"); // "truck" or "hauler"
  const [uploadGuideOpen, setUploadGuideOpen] = useState(false);
  const [uploadGuideType, setUploadGuideType] = useState(null); // pending type for guide → pick
  const [uploadPreviewData, setUploadPreviewData] = useState([]);
  const [uploadPreviewColumns, setUploadPreviewColumns] = useState([]);
  // My Requests / Activity Log states
  const [myRequests, setMyRequests] = useState([]);
  const [myRequestsLoading, setMyRequestsLoading] = useState(false);
  // FAQ collapsed keys
  const [faqActiveKey, setFaqActiveKey] = useState([]);
  // Profile modal
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  // Facility management modals (Leachate, Gas Vents, Trash Slide, Fire Prevention)
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
  const [wasteReceivedData, setWasteReceivedData] = useState({ lguR3: [], lguOutside: [], privateIndustry: [] });
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
    return withRetry(
      () => api.get("/settings/fields", { signal }),
      { retries: 3, signal },
    ).then(({ data }) => {
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
        if (f.section === "transport-info" && !KNOWN_TRANSPORT_KEYS.has(f.fieldKey) && f.fieldKey !== "hazWasteCode" && !f.fieldKey.toLowerCase().includes("hazwaste")) {
          extraTransport.push(f);
        }
      });
      setFieldLabels(map);
      setExtraTransportFields(extraTransport.sort((a, b) => a.order - b.order));
      fieldsLoadedRef.current = true;
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetchFieldSettings(ac.signal);
    return () => ac.abort();
  }, [fetchFieldSettings]);

  // ── Fetch regions with retry ──
  const regionsLoadedRef = useRef(false);
  const fetchRegions = useCallback((signal) => {
    return withRetry(
      () => api.get("/settings/address/regions", { signal }),
      { retries: 3, signal },
    ).then(({ data }) => {
      setRegions(data || []);
      regionsLoadedRef.current = true;
    }).catch(() => {});
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
    withRetry(() => api.get(`/settings/address/provinces/${regionCode}`), { retries: 2 })
      .then(({ data }) => setProvinces(data || []))
      .catch(() => showError({ type: "error", title: "Load Failed", message: "Could not load provinces. Please re-select the region." }))
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
    withRetry(() => api.get(`/settings/address/municipalities/${provinceCode}`), { retries: 2 })
      .then(({ data }) => setMunicipalities(data || []))
      .catch(() => showError({ type: "error", title: "Load Failed", message: "Could not load municipalities. Please re-select the province." }))
      .finally(() => setLoadingAddress(""));
  };

  const fetchBarangays = (municipalityCode) => {
    setBarangays([]);
    companyForm.setFieldsValue({ companyBarangay: undefined });
    if (!municipalityCode) return;
    setLoadingAddress("barangay");
    withRetry(() => api.get(`/settings/address/barangays/${municipalityCode}`), { retries: 2 })
      .then(({ data }) => setBarangays(data || []))
      .catch(() => showError({ type: "error", title: "Load Failed", message: "Could not load barangays. Please re-select the municipality." }))
      .finally(() => setLoadingAddress(""));
  };

  // ── Hauler address fetch helpers ──
  // Helper to update multiple address fields in haulerDraft at once
  const updateHaulerDraftAddr = (fields) => {
    setHaulerDraft(prev => ({ ...prev, ...fields }));
  };
  const fetchHaulerProvinces = (regionCode) => {
    setHaulerProvinces([]);
    setHaulerCities([]);
    setHaulerBarangayList([]);
    updateHaulerDraftAddr({ officeProvince: "", officeCity: "", officeBarangay: "" });
    if (!regionCode) return;
    setLoadingHaulerAddress("province");
    withRetry(() => api.get(`/settings/address/provinces/${regionCode}`), { retries: 2 })
      .then(({ data }) => setHaulerProvinces(data || []))
      .catch(() => showError({ type: "error", title: "Load Failed", message: "Could not load provinces." }))
      .finally(() => setLoadingHaulerAddress(""));
  };
  const fetchHaulerCities = (provinceCode) => {
    setHaulerCities([]);
    setHaulerBarangayList([]);
    updateHaulerDraftAddr({ officeCity: "", officeBarangay: "" });
    if (!provinceCode) return;
    setLoadingHaulerAddress("city");
    withRetry(() => api.get(`/settings/address/municipalities/${provinceCode}`), { retries: 2 })
      .then(({ data }) => setHaulerCities(data || []))
      .catch(() => showError({ type: "error", title: "Load Failed", message: "Could not load cities/municipalities." }))
      .finally(() => setLoadingHaulerAddress(""));
  };
  const fetchHaulerBarangays = (cityCode) => {
    setHaulerBarangayList([]);
    updateHaulerDraftAddr({ officeBarangay: "" });
    if (!cityCode) return;
    setLoadingHaulerAddress("barangay");
    withRetry(() => api.get(`/settings/address/barangays/${cityCode}`), { retries: 2 })
      .then(({ data }) => setHaulerBarangayList(data || []))
      .catch(() => showError({ type: "error", title: "Load Failed", message: "Could not load barangays." }))
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

  // Load portal user from storage, then refresh from server for latest status/isVerified
  useEffect(() => {
    const token = secureStorage.get("portal_token");
    const user = secureStorage.getJSON("portal_user");
    if (!token || !user) {
      navigate("/slfportal/login");
      return;
    }
    setPortalUser(user);
    setLoadingUser(false);

    // Refresh user data from server to pick up latest status & isVerified
    api.get("/portal-auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => {
        const refreshed = { ...user, status: data.status, isVerified: data.isVerified };
        secureStorage.setJSON("portal_user", refreshed);
        setPortalUser(refreshed);
      })
      .catch(() => {});

    // Connect socket for real-time notifications
    const sock = connectSocket("portal", user.email);
    return () => { disconnectSocket(); };
  }, [navigate]);

  const getNotifIcon = (type) => {
    if (type === "reverted") return <UndoOutlined style={{ color: "#fa541c" }} />;
    if (type === "status_change") return <CheckCircleOutlined style={{ color: "#52c41a" }} />;
    return <BellOutlined style={{ color: "#1a3353" }} />;
  };

  // Fetch SLF facility operational info
  const activeSlfId = Array.isArray(portalUser?.assignedSlf)
    ? portalUser.assignedSlf[selectedSlfIdx] || portalUser.assignedSlf[0]
    : portalUser?.assignedSlf;
  const activeSlfName = Array.isArray(portalUser?.assignedSlfName)
    ? portalUser.assignedSlfName[selectedSlfIdx] || portalUser.assignedSlfName[0]
    : portalUser?.assignedSlfName;

  useEffect(() => {
    if (!activeSlfId) return;
    const ac = new AbortController();
    setSlfInfoLoading(true);
    const nameParam = activeSlfName ? `?slfName=${encodeURIComponent(activeSlfName)}` : "";
    withRetry(
      () => api.get(`/slf-facilities/portal/${activeSlfId}${nameParam}`, { signal: ac.signal }),
      { retries: 3, signal: ac.signal },
    ).then(({ data }) => {
        setSlfInfo(data);
        setLeachateDetails((data.leachatePondDetails || []).map((p, i) => ({ ...p, _key: i })));
        setGasVentDetails((data.gasVentDetails || []).map((v, i) => ({ ...v, _key: i })));
        setTrashSlideDetails((data.trashSlideMeasures || []).map((m, i) => ({ ...m, _key: i })));
        setFirePrevDetails((data.firePrevMeasures || []).map((m, i) => ({ ...m, _key: i })));
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
      () => api.get(`/data-slf/baseline/${encodeURIComponent(activeSlfName)}`, { signal: ac.signal }),
      { retries: 3, signal: ac.signal },
    ).then(({ data }) => {
        if (data && data.totalVolumeAccepted != null) {
          const unit = data.baselineUnit || data.totalVolumeAcceptedUnit || "m³";
          setBaselineUnit(unit);
          setAcceptsHazardousWaste(data.acceptsHazardousWaste || false);
          baselineForm.setFieldsValue({
            baselineUnit: unit,
            totalVolumeAccepted: data.totalVolumeAccepted,
            totalVolumeAcceptedUnit: unit,
            activeCellResidualVolume: data.activeCellResidualVolume,
            activeCellResidualUnit: unit,
            activeCellInertVolume: data.activeCellInertVolume,
            activeCellInertUnit: unit,
            activeCellHazardousVolume: data.activeCellHazardousVolume,
            activeCellHazardousUnit: unit,
            closedCellResidualVolume: data.closedCellResidualVolume,
            closedCellResidualUnit: unit,
            closedCellInertVolume: data.closedCellInertVolume,
            closedCellInertUnit: unit,
            closedCellHazardousVolume: data.closedCellHazardousVolume,
            closedCellHazardousUnit: unit,
            acceptsHazardousWaste: data.acceptsHazardousWaste || false,
          });
          if (data.accreditedHaulers?.length > 0) {
            setHaulers(
              data.accreditedHaulers.map((h, i) => {
                let vehicles = Array.isArray(h.vehicles) ? h.vehicles : [];
                if (vehicles.length === 0 && (h.plateNumber || h.vehicleType || h.capacity != null)) {
                  vehicles = [{ plateNumber: h.plateNumber || "", vehicleType: h.vehicleType || "", capacity: h.capacity, capacityUnit: h.capacityUnit || "m³" }];
                }
                // Normalize privateSectorClients to array of objects
                let clients = Array.isArray(h.privateSectorClients) ? h.privateSectorClients : h.privateSectorClients ? [h.privateSectorClients] : [];
                clients = clients.map((c, ci) =>
                  typeof c === "string"
                    ? { key: ci, clientName: c, clientType: "Private", region: "", province: "", municipality: "" }
                    : { key: ci, ...c }
                );
                return {
                  key: Date.now() + i,
                  ...h,
                  vehicles,
                  privateSectorClients: clients,
                };
              }),
            );
          }
          // Load activeCellEntries from saved data (or migrate from flat fields)
          if (data.activeCellEntries?.length) {
            setActiveCellEntries(data.activeCellEntries.map((e, i) => ({ ...e, key: i })));
          } else {
            const entries = [];
            let k = 1;
            if (data.activeCellResidualVolume) entries.push({ key: k++, cellName: "", wasteType: "Residual", volume: data.activeCellResidualVolume });
            if (data.activeCellInertVolume) entries.push({ key: k++, cellName: "", wasteType: "Inert/Hazardous Waste", volume: data.activeCellInertVolume });
            setActiveCellEntries(entries);
          }
          // Load closedCellEntries from saved data (or migrate from flat fields)
          if (data.closedCellEntries?.length) {
            setClosedCellEntries(data.closedCellEntries.map((e, i) => ({ ...e, key: i })));
          } else {
            const cEntries = [];
            let ck = 1;
            if (data.closedCellResidualVolume) cEntries.push({ key: ck++, cellName: "", wasteType: "Residual", volume: data.closedCellResidualVolume });
            if (data.closedCellInertVolume) cEntries.push({ key: ck++, cellName: "", wasteType: "Inert/Hazardous Waste", volume: data.closedCellInertVolume });
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
      if (payload?.type === "baseline_update_approved" || payload?.type === "baseline_update_rejected" || payload?.type === "baseline_locked") {
        api.get(`/data-slf/baseline/${encodeURIComponent(activeSlfName)}`)
          .then(({ data }) => {
            if (data && data.totalVolumeAccepted != null) {
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
    return () => { sock.off("notification", handler); };
  }, [portalUser, activeSlfName]);

  // Fetch submission history
  const pollingRef = useRef(null);
  const fetchingRef = useRef(false);

  const fetchSubmissions = useCallback(async (silent = false) => {
    if (fetchingRef.current) return; // deduplicate concurrent requests
    fetchingRef.current = true;
    if (!silent) setLoadingSubmissions(true);
    try {
      const { data } = await api.get("/portal-auth/my-submissions", {
        headers: {
          Authorization: `Bearer ${secureStorage.get("portal_token")}`,
        },
      });
      setSubmissions(data);
    } catch {
      // silent
    } finally {
      fetchingRef.current = false;
      if (!silent) setLoadingSubmissions(false);
    }
  }, []);

  useEffect(() => {
    if (activeMenu === "history" && portalUser) {
      fetchSubmissions();
      // Real-time refresh via socket + fallback 60s polling
      const sock = connectSocket("portal", portalUser.email);
      const handler = () => fetchSubmissions(true);
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
  }, [activeMenu, portalUser, fetchSubmissions]);

  // When coming back online while on history tab, refresh immediately
  useEffect(() => {
    if (isOnline && activeMenu === "history" && portalUser) {
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
        (t) => requestTypes.has(t.type) && (t.submittedBy === portalUser.email || t.performedBy === portalUser.email)
      );
      setMyRequests(filtered);
    } catch { /* silent */ }
    finally { setMyRequestsLoading(false); }
  }, [portalUser]);

  useEffect(() => {
    if (activeMenu === "requests" && portalUser) {
      fetchMyRequests();
      const sock = connectSocket("portal", portalUser.email);
      const handler = () => fetchMyRequests();
      sock.on("notification", handler);
      sock.on("data-refresh", handler);
      return () => { sock.off("notification", handler); sock.off("data-refresh", handler); };
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
    if (isRequired("plateNumber", true) && !(truckDraft.vehicles || []).some(v => v.plateNumber?.trim()))
      errs.plateNumber = "At least one vehicle plate number is required";
    if (
      isRequired("actualVolume", true) &&
      !truckDraft.actualVolume &&
      truckDraft.actualVolume !== 0
    )
      errs.actualVolume = "Required";
    if (isRequired("wasteType", true) && !truckDraft.wasteType)
      errs.wasteType = "Required";
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
      if (vehicles.length === 0 && (record.plateNumber || record.vehicleType || record.capacity != null)) {
        vehicles = [{
          plateNumber: record.plateNumber || "",
          vehicleType: record.vehicleType || "",
          capacity: record.capacity,
          capacityUnit: record.capacityUnit || "m³",
        }];
      }
      const count = record.numberOfTrucks || vehicles.length || 0;
      // Ensure vehicles array matches numberOfTrucks
      while (vehicles.length < count) vehicles.push({ ...EMPTY_VEHICLE });
      if (vehicles.length > count && count > 0) vehicles = vehicles.slice(0, count);
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
        withRetry(() => api.get(`/settings/address/provinces/${record.officeRegion}`), { retries: 2 })
          .then(({ data }) => {
            setHaulerProvinces(data || []);
            if (record.officeProvince) {
              withRetry(() => api.get(`/settings/address/municipalities/${record.officeProvince}`), { retries: 2 })
                .then(({ data: d2 }) => {
                  setHaulerCities(d2 || []);
                  if (record.officeCity) {
                    withRetry(() => api.get(`/settings/address/barangays/${record.officeCity}`), { retries: 2 })
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
    const regionName = regions.find(r => r.code === haulerDraft.officeRegion)?.name || haulerDraft.officeRegion || "";
    const provinceName = haulerProvinces.find(p => p.code === haulerDraft.officeProvince)?.name || haulerDraft.officeProvince || "";
    const cityName = haulerCities.find(c => c.code === haulerDraft.officeCity)?.name || haulerDraft.officeCity || "";
    const barangayName = haulerBarangayList.find(b => b.code === haulerDraft.officeBarangay)?.name || haulerDraft.officeBarangay || "";
    const addressParts = [barangayName, cityName, provinceName, regionName].filter(Boolean);
    const resolvedAddress = addressParts.join(", ");
    const finalDraft = { ...haulerDraft, officeAddress: resolvedAddress };
    if (editingHaulerKey) {
      setHaulers((prev) =>
        prev.map((h) =>
          h.key === editingHaulerKey ? { ...h, ...finalDraft } : h,
        ),
      );
    } else {
      setHaulers((prev) => [...prev, { key: Date.now(), ...finalDraft }]);
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
        vehicles: record.vehicles?.length > 0
          ? record.vehicles.map((v, i) => ({ ...v, key: Date.now() + i }))
          : record.plateNumber
            ? [{ key: Date.now(), plateNumber: record.plateNumber, capacity: record.truckCapacity, capacityUnit: record.truckCapacityUnit || baselineUnit || "m³" }]
            : [{ ...EMPTY_VEHICLE, key: Date.now(), capacityUnit: baselineUnit || "m³" }],
        actualVolume: record.actualVolume,
        actualVolumeUnit: record.actualVolumeUnit || baselineUnit || "m³",
        wasteType: record.wasteType,
        hazWasteCode: record.hazWasteCode,
      };
      // Populate additional transport fields from record
      extraTransportFields.forEach((f) => {
        draft[f.fieldKey] = record[f.fieldKey] ?? (f.fieldType === "number" ? null : "");
      });
      setTruckDraft(draft);
    } else {
      setEditingTruckKey(null);
      const draft = {
        ...EMPTY_TRUCK,
        truckCapacityUnit: baselineUnit || "m³",
        actualVolumeUnit: baselineUnit || "m³",
        vehicles: [{ ...EMPTY_VEHICLE, key: Date.now(), capacityUnit: baselineUnit || "m³" }],
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
    if (!activeCellDraft.cellName || !activeCellDraft.wasteType || activeCellDraft.volume == null) {
      return;
    }
    if (editingActiveCellKey != null) {
      setActiveCellEntries(prev => prev.map(e => e.key === editingActiveCellKey ? { ...activeCellDraft, key: editingActiveCellKey } : e));
    } else {
      setActiveCellEntries(prev => [...prev, { ...activeCellDraft, key: Date.now() }]);
    }
    setActiveCellModalOpen(false);
  };

  // ── Closed Cell Entry helpers ──
  const handleSaveClosedCellEntry = () => {
    if (!closedCellDraft.cellName || !closedCellDraft.wasteType || closedCellDraft.volume == null) {
      return;
    }
    if (editingClosedCellKey != null) {
      setClosedCellEntries(prev => prev.map(e => e.key === editingClosedCellKey ? { ...closedCellDraft, key: editingClosedCellKey } : e));
    } else {
      setClosedCellEntries(prev => [...prev, { ...closedCellDraft, key: Date.now() }]);
    }
    setClosedCellModalOpen(false);
  };

  // ── Hauler Client helpers ──
  const handleSaveClient = () => {
    if (!clientDraft.clientName || !clientDraft.clientType) return;
    // Resolve PSGC codes to human-readable names for LGU type
    const regionName = (regions || []).find(r => String(r.code) === clientDraft.region)?.name || "";
    const provinceName = (clientProvinces || []).find(p => String(p.code) === clientDraft.province)?.name || "";
    const municipalityName = (clientMunicipalities || []).find(m => String(m.code) === clientDraft.municipality)?.name || "";
    const toSave = { ...clientDraft, regionName, provinceName, municipalityName };
    const existing = haulerDraft.privateSectorClients || [];
    if (editingClientKey != null) {
      updateHaulerDraft("privateSectorClients", existing.map(c => c.key === editingClientKey ? { ...toSave, key: editingClientKey } : c));
    } else {
      updateHaulerDraft("privateSectorClients", [...existing, { ...toSave, key: Date.now() }]);
    }
    setClientModalOpen(false);
  };

  const handleSaveTruck = () => {
    if (!validateTruck()) return;
    // Flatten first vehicle into top-level fields for backward compat
    const vehicles = (truckDraft.vehicles || []).map(({ key, ...rest }) => rest);
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
      showError({ type: "offline", title: "You\u2019re Offline", message: "Please check your internet connection and try again." });
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
        showError({ type: "offline", title: "Connection Lost", message: "Please check your internet connection and try again." });
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
      inputValidator: (v) => { if (!v?.trim()) return "Please provide a reason"; },
    });
    if (!reason) return;
    setBaselineUpdateLoading(true);
    try {
      await api.post("/data-slf/baseline-update-request", {
        slfName: activeSlfName,
        requestedBy: portalUser?.email,
        fields: ["Volume of Waste Accepted", "Total Volume Disposed in Active Cells", "Accredited Haulers", "Total Volume Disposed in Closed Cells"],
        reason: reason.trim(),
      });
      Swal.fire({
        icon: "success",
        title: "Request Sent",
        text: "Your baseline update request has been sent to the admin for review.",
        confirmButtonColor: "#1a3353",
      });
    } catch (err) {
      Swal.fire({ icon: "error", title: "Failed", text: err.response?.data?.message || "Could not send request." });
    } finally {
      setBaselineUpdateLoading(false);
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
      const baselineValues = baselineForm.getFieldsValue();
      // Compute legacy totals from entries for backward compat
      const activeCellResidualVolume = activeCellEntries
        .filter(e => e.wasteType === "Residual")
        .reduce((s, e) => s + (e.volume || 0), 0) || baselineValues.activeCellResidualVolume || undefined;
      const activeCellInertVolume = activeCellEntries
        .filter(e => e.wasteType === "Inert/Hazardous Waste")
        .reduce((s, e) => s + (e.volume || 0), 0) || baselineValues.activeCellInertVolume || undefined;
      const closedCellResidualVolume = closedCellEntries
        .filter(e => e.wasteType === "Residual")
        .reduce((s, e) => s + (e.volume || 0), 0) || baselineValues.closedCellResidualVolume || undefined;
      const closedCellInertVolume = closedCellEntries
        .filter(e => e.wasteType === "Inert/Hazardous Waste")
        .reduce((s, e) => s + (e.volume || 0), 0) || baselineValues.closedCellInertVolume || undefined;

      await api.patch(`/data-slf/portal-save-baseline/${encodeURIComponent(activeSlfName)}`, {
        submittedBy: portalUser?.email,
        baselineUnit,
        totalVolumeAccepted: baselineValues.totalVolumeAccepted,
        totalVolumeAcceptedUnit: baselineUnit,
        activeCellResidualVolume,
        activeCellResidualUnit: baselineUnit,
        activeCellInertVolume,
        activeCellInertUnit: baselineUnit,
        closedCellResidualVolume,
        closedCellResidualUnit: baselineUnit,
        closedCellInertVolume,
        closedCellInertUnit: baselineUnit,
        activeCellEntries: activeCellEntries.map(({ key, ...rest }) => rest),
        closedCellEntries: closedCellEntries.map(({ key, ...rest }) => rest),
        accreditedHaulers: haulers.map(({ key, ...rest }) => ({
          ...rest,
          privateSectorClients: (rest.privateSectorClients || []).map(({ key: ck, ...cr }) => cr),
        })),
      });

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
      Swal.fire({ icon: "error", title: "Save Failed", text: err.response?.data?.message || "Could not save baseline. Please try again." });
    } finally {
      setBaselineSavingLoading(false);
    }
  };

  // ── Save facility management details (leachate ponds, gas vents, etc.) ──
  const handleSaveFacilityDetails = async (type, data) => {
    if (!activeSlfId) return;
    setFacilityMgmtSaving(true);
    try {
      const payload = {};
      if (type === "leachate") payload.leachatePondDetails = data.map(({ _key, ...r }) => r);
      if (type === "gasVent") payload.gasVentDetails = data.map(({ _key, ...r }) => r);
      if (type === "trashSlide") payload.trashSlideMeasures = data.map(({ _key, ...r }) => r);
      if (type === "firePrev") payload.firePrevMeasures = data.map(({ _key, ...r }) => r);
      const { data: updated } = await api.patch(`/slf-facilities/portal/${activeSlfId}/facility-details`, payload);
      setSlfInfo(prev => ({ ...prev, ...updated }));
      Swal.fire({ icon: "success", title: "Saved!", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ icon: "error", title: "Save Failed", text: err.response?.data?.message || "Could not save details." });
    } finally {
      setFacilityMgmtSaving(false);
    }
  };

  // ── Fetch waste received summary ──
  const handleOpenWasteReceived = async () => {
    setWasteReceivedModalOpen(true);
    if (!activeSlfName) return;
    setWasteReceivedLoading(true);
    try {
      const { data } = await api.get(`/data-slf/waste-received-summary/${encodeURIComponent(activeSlfName)}`);
      setWasteReceivedData(data);
    } catch {
      setWasteReceivedData({ lguR3: [], lguOutside: [], privateIndustry: [] });
    } finally {
      setWasteReceivedLoading(false);
    }
  };

  // ── Support Ticket Functions ──
  const fetchSupportTickets = useCallback(async () => {
    if (!portalUser?.email) return;
    setSupportLoading(true);
    try {
      const { data } = await api.get(`/support-tickets/my-tickets/${encodeURIComponent(portalUser.email)}`);
      setSupportTickets(data);
    } catch { /* silent */ }
    finally { setSupportLoading(false); }
  }, [portalUser?.email]);

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
      Swal.fire({ icon: "success", title: "Ticket Submitted", text: "Your concern has been submitted. Our team will review and respond.", confirmButtonColor: "#1a3353" });
      fetchSupportTickets();
      setSupportTab("tickets");
    } catch (err) {
      Swal.fire({ icon: "error", title: "Failed", text: err.response?.data?.message || "Could not submit ticket." });
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
    } catch { /* silent */ }
  };

  // ── Excel/CSV Upload Handlers ──
  const handleExcelUpload = (file, type) => {
    if (type) setUploadType(type);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(ws, { defval: "" });
        if (jsonData.length === 0) {
          Swal.fire({ icon: "warning", title: "Empty File", text: "No data found in the uploaded file." });
          return;
        }
        // Normalize column names
        const normalized = jsonData.map((row, i) => {
          const normalized = { key: `upload-${i}-${Date.now()}` };
          for (const [key, value] of Object.entries(row)) {
            const k = key.toLowerCase().trim();
            if (uploadType === "truck") {
              if (k.includes("ticket") || k.includes("disposal")) normalized.disposalTicketNo = String(value);
              else if (k.includes("hauler")) normalized.hauler = String(value);
              else if (k.includes("plate")) normalized.plateNumber = String(value);
              else if (k.includes("capacity") && !k.includes("unit")) normalized.truckCapacity = Number(value) || null;
              else if (k.includes("volume") && !k.includes("unit")) normalized.actualVolume = Number(value) || null;
              else if (k.includes("waste") && k.includes("type")) normalized.wasteType = String(value);
              else if (k.includes("haz") || k.includes("code")) normalized.hazWasteCode = String(value).split(",").map(s => s.trim()).filter(Boolean);
            } else {
              if (k.includes("hauler") || k.includes("name")) normalized.haulerName = String(value);
              else if (k.includes("truck") || k.includes("number")) normalized.numberOfTrucks = Number(value) || null;
              else if (k.includes("office") || k.includes("address")) normalized.officeAddress = String(value);
              else if (k.includes("plate")) normalized.plateNumber = String(value);
              else if (k.includes("vehicle") || k.includes("type")) normalized.vehicleType = String(value);
              else if (k.includes("capacity") && !k.includes("unit")) normalized.capacity = Number(value) || null;
              else if (k.includes("client")) normalized.privateSectorClients = String(value).split(",").map(s => s.trim()).filter(Boolean);
            }
          }
          return normalized;
        });
        setUploadPreviewData(normalized);

        // Build editable columns
        if (uploadType === "truck") {
          setUploadPreviewColumns([
            { title: "#", width: 50, render: (_, __, i) => i + 1 },
            { title: "Ticket No.", dataIndex: "disposalTicketNo", key: "disposalTicketNo" },
            { title: "Hauler", dataIndex: "hauler", key: "hauler" },
            { title: "Plate No.", dataIndex: "plateNumber", key: "plateNumber" },
            { title: "Capacity", dataIndex: "truckCapacity", key: "truckCapacity" },
            { title: "Volume", dataIndex: "actualVolume", key: "actualVolume" },
            { title: "Waste Type", dataIndex: "wasteType", key: "wasteType" },
            { title: "Actions", key: "actions", width: 60, render: (_, r) => (
              <Button type="text" danger size="small" icon={<DeleteOutlined />}
                onClick={() => setUploadPreviewData(prev => prev.filter(p => p.key !== r.key))} />
            )},
          ]);
        } else {
          setUploadPreviewColumns([
            { title: "#", width: 50, render: (_, __, i) => i + 1 },
            { title: "Hauler Name", dataIndex: "haulerName", key: "haulerName" },
            { title: "Trucks", dataIndex: "numberOfTrucks", key: "numberOfTrucks" },
            { title: "Office Address", dataIndex: "officeAddress", key: "officeAddress" },
            { title: "Plate No.", dataIndex: "plateNumber", key: "plateNumber" },
            { title: "Vehicle Type", dataIndex: "vehicleType", key: "vehicleType" },
            { title: "Capacity", dataIndex: "capacity", key: "capacity" },
            { title: "Actions", key: "actions", width: 60, render: (_, r) => (
              <Button type="text" danger size="small" icon={<DeleteOutlined />}
                onClick={() => setUploadPreviewData(prev => prev.filter(p => p.key !== r.key))} />
            )},
          ]);
        }
        setUploadModalOpen(true);
      } catch {
        Swal.fire({ icon: "error", title: "Parse Error", text: "Could not parse the uploaded file. Please check the format." });
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
    input.onchange = (e) => { if (e.target.files[0]) handleExcelUpload(e.target.files[0], uploadGuideType); };
    input.click();
  };

  const handleConfirmUpload = () => {
    if (uploadPreviewData.length === 0) return;
    if (uploadType === "truck") {
      const newTrucks = uploadPreviewData.map((d) => ({
        key: d.key,
        disposalTicketNo: d.disposalTicketNo || "",
        hauler: d.hauler || "",
        plateNumber: d.plateNumber || "",
        truckCapacity: d.truckCapacity,
        truckCapacityUnit: baselineUnit || "m³",
        vehicles: d.plateNumber ? [{ plateNumber: d.plateNumber, capacity: d.truckCapacity, capacityUnit: baselineUnit || "m³" }] : [],
        actualVolume: d.actualVolume,
        actualVolumeUnit: baselineUnit || "m³",
        wasteType: d.wasteType || "Residual",
        hazWasteCode: d.hazWasteCode || [],
      }));
      setTrucks(prev => [...prev, ...newTrucks]);
    } else {
      const newHaulers = uploadPreviewData.map((d) => ({
        key: d.key,
        haulerName: d.haulerName || "",
        numberOfTrucks: d.numberOfTrucks || 1,
        officeAddress: d.officeAddress || "",
        vehicles: d.plateNumber ? [{
          plateNumber: d.plateNumber || "",
          vehicleType: d.vehicleType || "",
          capacity: d.capacity,
          capacityUnit: baselineUnit || "m³",
        }] : [],
        privateSectorClients: d.privateSectorClients || [],
      }));
      setHaulers(prev => [...prev, ...newHaulers]);
    }
    setUploadModalOpen(false);
    setUploadPreviewData([]);
    Swal.fire({ icon: "success", title: "Data Imported", text: `${uploadPreviewData.length} records imported successfully.`, timer: 1500, showConfirmButton: false });
  };

  // Update preview data cell
  const updateUploadCell = (key, field, value) => {
    setUploadPreviewData(prev => prev.map(r => r.key === key ? { ...r, [field]: value } : r));
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
    setTruckDraft(prev => ({
      ...prev,
      truckCapacityUnit: unit,
      actualVolumeUnit: unit,
      vehicles: (prev.vehicles || []).map(v => ({ ...v, capacityUnit: unit })),
    }));
    setTrucks(prev => prev.map(t => ({
      ...t,
      truckCapacityUnit: unit,
      actualVolumeUnit: unit,
      vehicles: (t.vehicles || []).map(v => ({ ...v, capacityUnit: unit })),
    })));
    setHaulers(prev => prev.map(h => ({
      ...h,
      vehicles: (h.vehicles || []).map(v => ({ ...v, capacityUnit: unit })),
    })));
  };

  // ── Edit reverted entry ──
  const [editingRevertedId, setEditingRevertedId] = useState(null);
  const [resubmitComment, setResubmitComment] = useState("");

  const handleEditReverted = (record) => {
    // Load record data into all forms
    entryForm.setFieldsValue({
      dateOfDisposal: record.dateOfDisposal ? dayjs(record.dateOfDisposal) : null,
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
      totalVolumeAcceptedUnit: record.totalVolumeAcceptedUnit,
      activeCellResidualVolume: record.activeCellResidualVolume,
      activeCellResidualUnit: record.activeCellResidualUnit,
      activeCellInertVolume: record.activeCellInertVolume,
      activeCellInertUnit: record.activeCellInertUnit,
      closedCellResidualVolume: record.closedCellResidualVolume,
      closedCellResidualUnit: record.closedCellResidualUnit,
      closedCellInertVolume: record.closedCellInertVolume,
      closedCellInertUnit: record.closedCellInertUnit,
    });
    // Load trucks
    const loadedTrucks = (record.trucks || []).map((t, i) => ({
      ...t,
      key: `reverted-${i}-${Date.now()}`,
    }));
    setTrucks(loadedTrucks);
    // Load haulers
    const loadedHaulers = (record.accreditedHaulers || []).map((h, i) => ({
      ...h,
      key: `reverted-hauler-${i}-${Date.now()}`,
    }));
    setHaulers(loadedHaulers);
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
      showError({ type: "offline", title: "You\u2019re Offline", message: "Please check your internet connection and try again." });
      return;
    }
    setLoading(true);
    try {
      const baselineValues = baselineForm.getFieldsValue();
      const companyValues = companyForm.getFieldsValue();
      const disposalValues = entryForm.getFieldsValue();
      const entry = {
        ...disposalValues,
        ...baselineValues,
        ...companyValues,
        accreditedHaulers: haulers.map(({ key, ...rest }) => rest),
        slfName: activeSlfName,
        slfGenerator: activeSlfId || null,
        dateOfDisposal: disposalValues.dateOfDisposal
          ? disposalValues.dateOfDisposal.format("YYYY-MM-DD")
          : null,
        trucks: trucks.map(({ key, vehicles, ...rest }) => ({ ...rest, vehicles: (vehicles || []).map(({ key: vk, ...vr }) => vr) })),
      };
      // Update the existing entry and set status back to pending
      await api.put(`/data-slf/${editingRevertedId}`, { ...entry, resubmitComment });
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
      showError({ type: "warning", title: "Incomplete Company Info", message: "Please complete the Company Information in the Basic Information tab." });
      setActiveTab("basic-info");
      return;
    }
    try {
      await baselineForm.validateFields();
    } catch {
      showError({ type: "warning", title: "Incomplete Baseline", message: "Please complete the Baseline Data tab first." });
      setActiveTab("baseline");
      return;
    }
    try {
      await entryForm.validateFields();
    } catch {
      showError({ type: "warning", title: "Incomplete Disposal Report", message: "Please complete all required fields in the Disposal Report tab." });
      setActiveTab("disposal");
      return;
    }
    if (trucks.length === 0) {
      showError({ type: "warning", title: "No Entries Added", message: "Please add at least one transport entry." });
      setActiveTab("disposal");
      return;
    }
    const firstTruck = trucks[0];
    if (!firstTruck?.lguCompanyName || !firstTruck?.companyType) {
      showError({ type: "warning", title: "Incomplete Waste Generator Info", message: "Please fill in Company Name and Company Type in the first transport entry." });
      setActiveTab("disposal");
      return;
    }
    setReviewModalOpen(true);
  };

  const handleConfirmSubmit = async () => {
    if (!navigator.onLine) {
      showError({ type: "offline", title: "You\u2019re Offline", message: "Please check your internet connection and try again." });
      return;
    }
    setLoading(true);
    try {
      const baselineValues = baselineForm.getFieldsValue();
      const companyValues = companyForm.getFieldsValue();
      const disposalValues = entryForm.getFieldsValue();
      const firstTruck = trucks[0] || {};
      // Compute active cell totals from entries for backward compat
      const activeCellResidualVolume = activeCellEntries
        .filter(e => e.wasteType === "Residual")
        .reduce((s, e) => s + (e.volume || 0), 0) || baselineValues.activeCellResidualVolume || 0;
      const activeCellInertVolume = activeCellEntries
        .filter(e => e.wasteType === "Inert/Hazardous Waste")
        .reduce((s, e) => s + (e.volume || 0), 0) || baselineValues.activeCellInertVolume || 0;
      // Compute closed cell totals from entries for backward compat
      const closedCellResidualVolume = closedCellEntries
        .filter(e => e.wasteType === "Residual")
        .reduce((s, e) => s + (e.volume || 0), 0) || baselineValues.closedCellResidualVolume || 0;
      const closedCellInertVolume = closedCellEntries
        .filter(e => e.wasteType === "Inert/Hazardous Waste")
        .reduce((s, e) => s + (e.volume || 0), 0) || baselineValues.closedCellInertVolume || 0;
      const entry = {
        ...disposalValues,
        ...baselineValues,
        ...companyValues,
        // Company info comes from first transport entry
        lguCompanyName: firstTruck.lguCompanyName || disposalValues.lguCompanyName || "",
        companyType: firstTruck.companyType || disposalValues.companyType || "",
        address: firstTruck.address || disposalValues.address || "",
        // Active cell entries
        activeCellEntries: activeCellEntries.map(({ key, ...rest }) => rest),
        activeCellResidualVolume,
        activeCellInertVolume,
        // Closed cell entries
        closedCellEntries: closedCellEntries.map(({ key, ...rest }) => rest),
        closedCellResidualVolume,
        closedCellInertVolume,
        accreditedHaulers: haulers.map(({ key, ...rest }) => ({
          ...rest,
          privateSectorClients: (rest.privateSectorClients || []).map(({ key: ck, ...cr }) => cr),
        })),
        slfName: activeSlfName,
        slfGenerator: activeSlfId || null,
        dateOfDisposal: disposalValues.dateOfDisposal
          ? disposalValues.dateOfDisposal.format("YYYY-MM-DD")
          : null,
        trucks: trucks.map(({ key, vehicles, ...rest }) => ({ ...rest, vehicles: (vehicles || []).map(({ key: vk, ...vr }) => vr) })),
        acceptsHazardousWaste: false,
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
      if (!navigator.onLine || err.code === "ERR_NETWORK" || err.message === "Network Error") {
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
          message: err.response?.data?.message || "Something went wrong. Please try again.",
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
        if (vehs.length > 1) return vehs.map(v => v.plateNumber).filter(Boolean).join(", ") || t.plateNumber || "—";
        return vehs[0]?.plateNumber || t.plateNumber || "—";
      },
    },
    {
      title: "Capacity",
      key: "cap",
      render: (_, t) => {
        const vehs = t.vehicles || [];
        if (vehs.length > 1) return vehs.filter(v => v.capacity != null).map(v => `${v.capacity} ${(v.capacityUnit || "m³").replace("m3", "m³")}`).join(", ") || "—";
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
        const veh = h.vehicles?.length > 0 ? h.vehicles : (h.plateNumber || h.vehicleType) ? [{ plateNumber: h.plateNumber, vehicleType: h.vehicleType, capacity: h.capacity, capacityUnit: h.capacityUnit }] : [];
        if (veh.length === 0) return "—";
        return veh.map((v, i) => (
          <div key={i} style={{ fontSize: 12, lineHeight: "18px" }}>
            {v.vehicleType || "—"} · {v.plateNumber || "—"}{v.capacity != null ? ` · ${v.capacity} ${(v.capacityUnit || "m³").replace("m3", "m³")}` : ""}
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
              {name}{type ? <Tag color={type === "LGU" ? "blue" : "green"} style={{ marginLeft: 4, fontSize: 10 }}>{type}</Tag> : null}
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
          <Tooltip title="Request hauler deletion">
            <Button
              type="text"
              danger
              size="small"
              icon={<DeleteOutlined />}
              onClick={() => {
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
          {r.status === "acknowledged" && !r.revertRequested && !r.editRequested && (
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
          {r.editRequested && r.status !== "reverted" && r.status !== "editApproved" && (
            <Tag color="processing" style={{ fontSize: 11 }}>Edit Pending</Tag>
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

  const revertedCount = submissions.filter((s) => s.status === "reverted").length;

  const menuItems = [
    { key: "data-entry", icon: <FileTextOutlined />, label: "Data Entry" },
    {
      key: "history",
      icon: <HistoryOutlined />,
      label: (
        <span>
          Submission History
          {revertedCount > 0 && (
            <Badge count={revertedCount} size="small" style={{ marginLeft: 8, backgroundColor: "#fa541c" }} />
          )}
        </span>
      ),
    },
    { key: "requests", icon: <AuditOutlined />, label: "My Requests" },
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
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* SLF selector for users with multiple assigned SLFs */}
        {Array.isArray(portalUser?.assignedSlfName) && portalUser.assignedSlfName.length > 1 && (
          <Card size="small" style={{ marginBottom: 12, borderRadius: 10, border: "1px solid #91caff", background: "#e6f4ff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <EnvironmentOutlined style={{ color: "#1a3353", fontSize: 16 }} />
              <Text strong style={{ fontSize: 13 }}>Select SLF Facility:</Text>
              <Select
                value={selectedSlfIdx}
                onChange={(val) => {
                  setSelectedSlfIdx(val);
                  setBaselineSaved(false);
                  setSlfInfo(null);
                  baselineForm.resetFields();
                }}
                style={{ minWidth: 280 }}
                options={portalUser.assignedSlfName.map((name, i) => ({ label: name, value: i }))}
              />
            </div>
          </Card>
        )}
        {/* SLF Name (read-only, from assigned SLF) */}
        <Card
          className="slf-section slf-facility-card"
          styles={{ header: { background: "linear-gradient(135deg, #1a3353 0%, #2d5f8a 100%)", borderRadius: "10px 10px 0 0", padding: isMobile ? "14px 16px" : "16px 24px", cursor: "pointer" }, body: { padding: slfCardExpanded ? (isMobile ? 16 : 24) : 0, overflow: "hidden", maxHeight: slfCardExpanded ? 3000 : 0, transition: "max-height 0.35s ease, padding 0.35s ease" } }}
          title={
            <div style={{ display: "flex", alignItems: "center", gap: 10 }} onClick={() => setSlfCardExpanded((v) => !v)}>
              <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 14, transition: "transform 0.3s", transform: slfCardExpanded ? "rotate(180deg)" : "rotate(0deg)", display: "flex", alignItems: "center" }}>
                <DownOutlined />
              </div>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <BankOutlined style={{ color: "#fff", fontSize: 18 }} />
              </div>
              <div style={{ flex: 1 }}>
                <Text strong style={{ fontSize: isMobile ? 14 : 16, color: "#fff", display: "block", lineHeight: 1.3 }}>
                  {isMobile ? "Assigned SLF" : "Assigned Sanitary Landfill Facility"}
                </Text>
                <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{activeSlfName}</Text>
              </div>
            </div>
          }
          extra={
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleReviewOpen}
              loading={loading}
              className="slf-primary-btn"
              size={isMobile ? "middle" : "large"}
              style={{ background: "#fff", color: "#1a3353", fontWeight: 600, border: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}
            >
              {isMobile ? "Submit" : "Review & Submit"}
            </Button>
          }
        >
          {slfInfoLoading ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <Spin size="large" />
              <div style={{ marginTop: 12 }}><Text type="secondary">Loading facility data...</Text></div>
            </div>
          ) : slfInfo ? (() => {
            const capacity = slfInfo.volumeCapacity || 0;
            const facilityWaste = slfInfo.actualResidualWasteReceived || 0;
            // Use baseline totalVolumeAccepted if available for more accurate utilization
            const baselineVol = baselineForm.getFieldValue("totalVolumeAccepted");
            const waste = baselineVol != null && baselineVol > 0 ? baselineVol : facilityWaste;
            const pct = capacity > 0 ? Math.min(Math.round((waste / capacity) * 100), 100) : 0;
            const cells = slfInfo.numberOfCell || 0;
            const cellCaps = slfInfo.cellCapacities || [];
            const cellStatuses = slfInfo.cellStatuses || [];
            const cellTypes = slfInfo.cellTypes || [];
            const operationalCells = cellStatuses.filter(s => s !== "Closed").length;
            const closedCells = cellStatuses.filter(s => s === "Closed").length;
            const residualCells = cellTypes.filter(t => t !== "Treated Haz Waste").length || cells;
            const hazCells = cellTypes.filter(t => t === "Treated Haz Waste").length;
            const capColor = pct >= 90 ? "#ff4d4f" : pct >= 70 ? "#faad14" : "#52c41a";
            const capLabel = pct >= 90 ? "Critical" : pct >= 70 ? "Warning" : "Normal";
            const isOp = !slfInfo.statusOfSLF?.toLowerCase().includes("non");
            // Baseline cell breakdown
            const activeCellRes = baselineForm.getFieldValue("activeCellResidualVolume") || 0;
            const activeCellInert = baselineForm.getFieldValue("activeCellInertVolume") || 0;
            const closedCellRes = baselineForm.getFieldValue("closedCellResidualVolume") || 0;
            const closedCellInert = baselineForm.getFieldValue("closedCellInertVolume") || 0;
            const hasBaselineCell = activeCellRes > 0 || activeCellInert > 0 || closedCellRes > 0 || closedCellInert > 0;
            // LGU served split (from baseline hauler clients)
            const allClients = haulers.flatMap(h => h.privateSectorClients || []).filter(c => c.clientType === "LGU");
            const lguR3Clients = allClients.filter(c => (c.region || "").startsWith("03") || (c.regionName || "").toLowerCase().includes("iii") || (c.regionName || "").toLowerCase().includes("central luzon"));
            const lguOutsideClients = allClients.filter(c => !((c.region || "").startsWith("03") || (c.regionName || "").toLowerCase().includes("iii") || (c.regionName || "").toLowerCase().includes("central luzon")));
            return (
              <div>
                {/* Capacity overview banner */}
                <div style={{ background: `linear-gradient(135deg, ${capColor}08 0%, ${capColor}15 100%)`, border: `1px solid ${capColor}30`, borderRadius: 12, padding: isMobile ? 16 : 20, marginBottom: 20 }}>
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
                            <div style={{ fontSize: 22, fontWeight: 800, color: capColor }}>{pct}%</div>
                            <div style={{ fontSize: 10, color: "#8c8c8c", fontWeight: 500 }}>UTILIZATION</div>
                          </div>
                        )}
                      />
                      <Tag color={capColor} style={{ marginTop: 6, fontWeight: 600, fontSize: 11 }}>{capLabel}</Tag>
                    </Col>
                    <Col xs={24} sm={18}>
                      <Row gutter={[12, 12]}>
                        {/* Status */}
                        <Col xs={12} sm={12} md={6}>
                          <div style={{ background: isOp ? "#f6ffed" : "#fff2f0", borderRadius: 10, padding: "12px 14px", border: `1px solid ${isOp ? "#b7eb8f" : "#ffccc7"}`, height: "100%" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                              <CheckCircleOutlined style={{ color: isOp ? "#52c41a" : "#ff4d4f", fontSize: 13 }} />
                              <span style={{ fontSize: 10, color: "#8c8c8c", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600 }}>Status</span>
                            </div>
                            <Tag color={isOp ? "success" : "error"} style={{ fontSize: 12, fontWeight: 600, padding: "2px 10px" }}>{slfInfo.statusOfSLF || "—"}</Tag>
                          </div>
                        </Col>
                        {/* Cells: Operational / Closed */}
                        <Col xs={12} sm={12} md={6}>
                          <div style={{ background: "#e6f7ff", borderRadius: 10, padding: "12px 14px", border: "1px solid #91d5ff", height: "100%" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                              <ContainerOutlined style={{ color: "#1890ff", fontSize: 13 }} />
                              <span style={{ fontSize: 10, color: "#8c8c8c", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600 }}>Cells</span>
                            </div>
                            {cells > 0 ? (
                              <div>
                                <Tag color="success" style={{ fontSize: 11, marginBottom: 2 }}>Op: {operationalCells}</Tag>
                                {closedCells > 0 && <Tag color="default" style={{ fontSize: 11 }}>Closed: {closedCells}</Tag>}
                              </div>
                            ) : <div style={{ fontSize: 16, fontWeight: 700, color: "#1890ff" }}>—</div>}
                            {cells > 0 && cellTypes.length > 0 && (
                              <div style={{ marginTop: 4 }}>
                                <Tag color="blue" style={{ fontSize: 10 }}>Res: {residualCells}</Tag>
                                {hazCells > 0 && <Tag color="red" style={{ fontSize: 10 }}>THW: {hazCells}</Tag>}
                              </div>
                            )}
                          </div>
                        </Col>
                        {/* Waste Filled — clickable */}
                        <Col xs={12} sm={12} md={6}>
                          <div
                            style={{ background: "#fff7e6", borderRadius: 10, padding: "12px 14px", border: "1px solid #ffd591", height: "100%", cursor: "pointer", transition: "box-shadow 0.2s" }}
                            onClick={handleOpenWasteReceived}
                            title="Click to view waste received breakdown"
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                              <BarChartOutlined style={{ color: "#fa8c16", fontSize: 13 }} />
                              <span style={{ fontSize: 10, color: "#8c8c8c", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600 }}>Waste Filled</span>
                              <EyeOutlined style={{ marginLeft: "auto", color: "#fa8c16", fontSize: 11 }} />
                            </div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: "#fa8c16" }}>{waste > 0 ? `${waste.toLocaleString()} ${baselineUnit || "m³"}` : "—"}</div>
                            {baselineVol != null && baselineVol > 0 && <div style={{ fontSize: 10, color: "#8c8c8c", fontWeight: 500, marginTop: 2 }}>From Baseline • Tap for breakdown</div>}
                          </div>
                        </Col>
                        {/* Volume Capacity + LGUs Served */}
                        <Col xs={12} sm={12} md={6}>
                          <div style={{ background: "#f9f0ff", borderRadius: 10, padding: "12px 14px", border: "1px solid #d3adf7", height: "100%" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                              <DatabaseOutlined style={{ color: "#722ed1", fontSize: 13 }} />
                              <span style={{ fontSize: 10, color: "#8c8c8c", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600 }}>Capacity</span>
                            </div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: "#722ed1" }}>{capacity > 0 ? `${capacity.toLocaleString()} ${baselineUnit || "m³"}` : "—"}</div>
                            {capacity > 0 && waste > 0 && <div style={{ fontSize: 10, color: "#8c8c8c", fontWeight: 500, marginTop: 2 }}>{Math.max(0, capacity - waste).toLocaleString()} remaining</div>}
                          </div>
                        </Col>
                      </Row>
                      {/* LGUs Served split */}
                      {allClients.length > 0 && (
                        <div style={{ marginTop: 12, background: "#f0f5ff", borderRadius: 10, padding: "10px 14px", border: "1px solid #adc6ff" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                            <TeamOutlined style={{ color: "#2f54eb", fontSize: 13 }} />
                            <span style={{ fontSize: 10, color: "#2f54eb", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600 }}>LGUs Served</span>
                          </div>
                          <Space size={8} wrap>
                            <Tag color="geekblue">Region III: {lguR3Clients.length}</Tag>
                            <Tag color="cyan">Outside R3: {lguOutsideClients.length}</Tag>
                            <Text style={{ fontSize: 11, color: "#8c8c8c" }}>Total: {allClients.length}</Text>
                          </Space>
                        </div>
                      )}
                    </Col>
                  </Row>
                </div>

                {/* Cell Infrastructure & Baseline Utilization — side by side */}
                <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
                  {cells > 0 && cellCaps.length > 0 && (
                    <Col xs={24} md={baselineSaved ? 14 : 24}>
                  <div style={{ background: "#fff", borderRadius: 12, padding: isMobile ? 14 : 20, border: "1px solid #e8e8e8", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", height: "100%" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 6, background: "#1a3353", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <PieChartOutlined style={{ color: "#fff", fontSize: 13 }} />
                      </div>
                      <Text strong style={{ fontSize: 14, color: "#1a3353" }}>Cell Infrastructure</Text>
                      <Space size={4} style={{ marginLeft: "auto" }}>
                        <Tag color="success">Operational: {operationalCells}</Tag>
                        {closedCells > 0 && <Tag color="default">Closed: {closedCells}</Tag>}
                      </Space>
                    </div>
                    <Row gutter={[12, 12]}>
                      {cellCaps.map((cap, i) => {
                        const cellPct = capacity > 0 && cap > 0 ? Math.min(Math.round((cap / capacity) * 100 * cells), 100) : 0;
                        const cellSt = cellStatuses[i] || "Operational";
                        const cellT = cellTypes[i] || "Residual";
                        const isClosed = cellSt === "Closed";
                        const isHaz = cellT === "Treated Haz Waste";
                        const cellColor = isClosed ? "#d9d9d9" : isHaz ? "#f5222d" : cellPct >= 90 ? "#ff4d4f" : cellPct >= 70 ? "#faad14" : "#52c41a";
                        return (
                          <Col xs={12} sm={8} md={Math.min(8, Math.floor(24 / cells))} key={i}>
                            <div style={{ background: isClosed ? "#fafafa" : "#fff", borderRadius: 10, padding: "14px 12px", border: `1px solid ${isClosed ? "#e8e8e8" : cellColor}30`, textAlign: "center", opacity: isClosed ? 0.7 : 1 }}>
                              <Progress
                                type="dashboard"
                                percent={isClosed ? 100 : cellPct}
                                size={isMobile ? 64 : 80}
                                strokeWidth={6}
                                strokeColor={cellColor}
                                format={() => (
                                  <span style={{ fontSize: isMobile ? 13 : 15, fontWeight: 700, color: cellColor }}>
                                    {isClosed ? "—" : `${cellPct}%`}
                                  </span>
                                )}
                              />
                              <div style={{ fontWeight: 700, fontSize: 13, color: "#1a3353", marginTop: 6 }}>Cell {i + 1}</div>
                              <Tag color={isClosed ? "default" : "success"} style={{ fontSize: 10, marginTop: 4 }}>{cellSt}</Tag>
                              <Tag color={isHaz ? "red" : "blue"} style={{ fontSize: 10, marginTop: 2 }}>{cellT}</Tag>
                              <div style={{ fontSize: 11, color: "#8c8c8c", marginTop: 4, fontWeight: 500 }}>
                                {cap > 0 ? `${cap.toLocaleString()} ${baselineUnit || "m³"}` : "—"}
                              </div>
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
                  <div style={{ background: "#fff", borderRadius: 12, padding: isMobile ? 14 : 20, border: "1px solid #e8e8e8", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", height: "100%" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 6, background: "#722ed1", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <DatabaseOutlined style={{ color: "#fff", fontSize: 13 }} />
                      </div>
                      <Text strong style={{ fontSize: 14, color: "#1a3353" }}>Baseline Utilization</Text>
                      <Tag color="purple" style={{ marginLeft: "auto", fontWeight: 500 }}>From Baseline Data</Tag>
                    </div>
                    {hasBaselineCell ? (
                      <Row gutter={[12, 12]}>
                        {[
                          { label: "Active Cell (Residual)", value: activeCellRes, unit: baselineUnit || "m³", color: "#52c41a" },
                          { label: "Active Cell (Inert)", value: activeCellInert, unit: baselineUnit || "m³", color: "#1890ff" },
                          { label: "Closed Cell (Residual)", value: closedCellRes, unit: baselineUnit || "m³", color: "#fa8c16" },
                          { label: "Closed Cell (Inert)", value: closedCellInert, unit: baselineUnit || "m³", color: "#8c8c8c" },
                        ].filter((d) => d.value > 0).map((item, idx) => (
                          <Col xs={12} sm={12} md={6} key={idx}>
                            <div style={{ background: `${item.color}08`, borderRadius: 10, padding: "12px 14px", border: `1px solid ${item.color}30`, textAlign: "center" }}>
                              <div style={{ fontSize: 10, color: "#8c8c8c", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, marginBottom: 4 }}>{item.label}</div>
                              <div style={{ fontSize: 16, fontWeight: 700, color: item.color }}>{Number(item.value).toLocaleString()}</div>
                              <div style={{ fontSize: 10, color: "#8c8c8c" }}>{item.unit}</div>
                            </div>
                          </Col>
                        ))}
                      </Row>
                    ) : (
                      <div style={{ background: "#fff7e6", border: "1px solid #ffe58f", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                        <InfoCircleOutlined style={{ color: "#faad14" }} />
                        <Text style={{ color: "#ad6800", fontSize: 12 }}>
                          Cell volume breakdown not yet encoded in baseline data. Request an update to provide active/closed cell volumes.
                        </Text>
                      </div>
                    )}
                  </div>
                    </Col>
                  )}
                </Row>

                {/* Facility Details */}
                <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e8e8e8", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 20px", borderBottom: "1px solid #f0f0f0", background: "#fafbfc" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: "#1a3353", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <FileTextOutlined style={{ color: "#fff", fontSize: 13 }} />
                    </div>
                    <Text strong style={{ fontSize: 14, color: "#1a3353" }}>Facility Details</Text>
                  </div>
                  <div style={{ padding: isMobile ? 12 : 16 }}>
                    <Row gutter={[16, 12]}>
                      {[
                        slfInfo.category && { label: "Category", value: slfInfo.category },
                        slfInfo.yearStartedOperation && { label: "Year Started", value: slfInfo.yearStartedOperation },
                        slfInfo.remainingLifeSpan && { label: "Remaining Lifespan", value: slfInfo.remainingLifeSpan },
                        slfInfo.noOfLeachatePond != null && { label: "Leachate Ponds", value: slfInfo.noOfLeachatePond },
                        slfInfo.numberOfGasVents != null && { label: "Gas Vents", value: slfInfo.numberOfGasVents },
                        [slfInfo.barangay, slfInfo.lgu, slfInfo.province].some(Boolean) && { label: "Location", value: [slfInfo.barangay, slfInfo.lgu, slfInfo.province].filter(Boolean).join(", ") },
                        slfInfo.ownership && { label: "Ownership", value: slfInfo.ownership },
                        slfInfo.mrfEstablished && { label: "MRF Status", value: slfInfo.mrfEstablished },
                        slfInfo.eccNo && { label: "ECC No.", value: slfInfo.eccNo },
                        slfInfo.dischargePermit && { label: "Discharge Permit", value: slfInfo.dischargePermit },
                        slfInfo.permitToOperate && { label: "Permit to Operate", value: slfInfo.permitToOperate },
                        slfInfo.hazwasteGenerationId && { label: "Hazwaste Gen. ID", value: slfInfo.hazwasteGenerationId },
                      ].filter(Boolean).map((item, idx) => (
                        <Col xs={24} sm={12} md={8} key={idx}>
                          <div style={{ padding: "8px 12px", borderRadius: 8, background: "#f8f9fb" }}>
                            <div style={{ fontSize: 11, color: "#8c8c8c", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, marginBottom: 2 }}>{item.label}</div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#262626", wordBreak: "break-word" }}>{item.value}</div>
                          </div>
                        </Col>
                      ))}
                    </Row>
                  </div>
                </div>

              </div>
            );
          })() : (
            <div style={{ background: "linear-gradient(135deg, #fffbe6 0%, #fff8e1 100%)", border: "1px solid #ffe58f", borderRadius: 10, padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 }}>
              <InfoCircleOutlined style={{ color: "#faad14", fontSize: 20 }} />
              <div>
                <Text strong style={{ color: "#ad6800", display: "block" }}>Facility Data Unavailable</Text>
                <Text style={{ color: "#ad6800", fontSize: 12 }}>
                  SLF operational data is currently being processed. Details will appear here once available.
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
            items={[
              {
                key: "basic-info",
                label: (
                  <span>
                    <InfoCircleOutlined />{" "}
                    {isMobile ? "Basic Info" : "Basic Information"}
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
                        entryForm.setFieldsValue({ lguCompanyName: changed.lguCompanyName });
                      }
                      if ("companyRegion" in changed || "companyProvince" in changed || "companyMunicipality" in changed || "companyBarangay" in changed) {
                        const parts = [
                          barangays.find(b => b.code === vals.companyBarangay)?.name,
                          municipalities.find(m => m.code === vals.companyMunicipality)?.name,
                          provinces.find(p => p.code === vals.companyProvince)?.name,
                          regions.find(r => r.code === vals.companyRegion)?.name,
                        ].filter(Boolean);
                        entryForm.setFieldsValue({ address: parts.join(", ") });
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
                            disabled={provinces.length === 0 && loadingAddress !== "province"}
                            loading={loadingAddress === "province"}
                            notFoundContent={loadingAddress === "province" ? <Spin size="small" /> : undefined}
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
                            disabled={municipalities.length === 0 && loadingAddress !== "municipality"}
                            loading={loadingAddress === "municipality"}
                            notFoundContent={loadingAddress === "municipality" ? <Spin size="small" /> : undefined}
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
                            disabled={barangays.length === 0 && loadingAddress !== "barangay"}
                            loading={loadingAddress === "barangay"}
                            notFoundContent={loadingAddress === "barangay" ? <Spin size="small" /> : undefined}
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
                          background: baselineUpdatePending ? "#e6f7ff" : "#fff7e6",
                          border: `1px solid ${baselineUpdatePending ? "#91d5ff" : "#ffe58f"}`,
                          borderRadius: 6,
                          padding: "10px 14px",
                          marginBottom: 16,
                          display: "flex",
                          alignItems: isMobile ? "flex-start" : "center",
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                          gap: 8,
                        }}
                      >
                        <div>
                          <InfoCircleOutlined
                            style={{ color: baselineUpdatePending ? "#1890ff" : "#faad14", marginRight: 8 }}
                          />
                          <Text style={{ color: baselineUpdatePending ? "#096dd9" : "#ad6800" }}>
                            {baselineUpdatePending
                              ? "Your baseline update request is pending admin approval. Please wait for a response."
                              : "Baseline data is locked after your first submission. To request changes, click the button."}
                          </Text>
                        </div>
                        {!baselineUpdatePending && (
                          <Button
                            type="primary"
                            size="small"
                            icon={<SendOutlined />}
                            loading={baselineUpdateLoading}
                            onClick={handleBaselineUpdateRequest}
                            style={{ background: "#fa8c16", borderColor: "#fa8c16" }}
                          >
                            Request Update
                          </Button>
                        )}
                        {baselineUpdatePending && (
                          <Tag color="processing" icon={<ClockCircleOutlined />}>Awaiting Approval</Tag>
                        )}
                      </div>
                    )}
                    <Form
                      form={baselineForm}
                      layout="vertical"
                      requiredMark={false}
                      disabled={baselineSaved}
                    >
                      {/* ── Unit of Measurement ── */}
                      <div style={{ background: "linear-gradient(135deg, #e6f4ff 0%, #f0f5ff 100%)", border: "1px solid #91caff", borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: "#1677ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <DatabaseOutlined style={{ color: "#fff", fontSize: 15 }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 120 }}>
                          <Text strong style={{ fontSize: 13, color: "#003eb3", display: "block" }}>Unit of Measurement</Text>
                          <Text type="secondary" style={{ fontSize: 11 }}>Applies to all volume fields below</Text>
                        </div>
                        <Select value={baselineUnit} onChange={handleBaselineUnitChange} disabled={baselineSaved} style={{ width: 200 }}>
                          <Option value="m³">m³ (cubic meters)</Option>
                          <Option value="tons">tons</Option>
                        </Select>
                      </div>

                      {/* ── Volume of Waste Accepted ── */}
                      <div style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "linear-gradient(90deg, #1a3353 0%, #244b7a 100%)" }}>
                          <BarChartOutlined style={{ color: "#fff", fontSize: 13 }} />
                          <Text strong style={{ color: "#fff", fontSize: 13 }}>Volume of Waste Accepted</Text>
                          <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 11, marginLeft: 2 }}>(since start of operation)</Text>
                        </div>
                        <div style={{ padding: "14px 16px 8px" }}>
                          <Row gutter={[12, 0]}>
                            <Col xs={24} sm={14} md={10}>
                              <Form.Item
                                name="totalVolumeAccepted"
                                label="Total Volume Accepted"
                                required
                                rules={[{ required: true, message: "Required" }]}
                              >
                                <InputNumber
                                  placeholder="0.00"
                                  style={{ width: "100%" }}
                                  min={0}
                                  step={0.01}
                                  precision={2}
                                  addonAfter={baselineUnit === "m³" ? "m³" : "tons"}
                                  formatter={(v) => v ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }) : ""}
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
                        style={{ background: "transparent", marginBottom: 14 }}
                        items={[
                          {
                            key: "active",
                            label: (
                              <Space>
                                <CheckCircleOutlined style={{ color: "#52c41a" }} />
                                <Text strong style={{ color: "#135200" }}>
                                  Active Cells{activeCellEntries.length > 0 ? ` (${activeCellEntries.length})` : ""}
                                </Text>
                                {activeCellEntries.length > 0 && (
                                  <Text type="secondary" style={{ fontSize: 11 }}>
                                    Total: {activeCellEntries.reduce((s, e) => s + (e.volume || 0), 0).toLocaleString()} {baselineUnit || "m³"}
                                  </Text>
                                )}
                              </Space>
                            ),
                            extra: !baselineSaved && (
                              <Button size="small" icon={<PlusOutlined />} onClick={(e) => { e.stopPropagation(); setEditingActiveCellKey(null); setActiveCellDraft({ cellName: "", wasteType: "Residual", volume: null }); setActiveCellModalOpen(true); }}>
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
                                locale={{ emptyText: <Text type="secondary" style={{ fontSize: 12 }}>No entries yet.{!baselineSaved && " Click \"Add Entry\" above to add cell data."}</Text> }}
                                columns={[
                                  { title: "#", key: "idx", width: 42, render: (_, __, i) => <Text style={{ fontSize: 12, color: "#8c8c8c" }}>{i + 1}</Text> },
                                  { title: "Cell Name", dataIndex: "cellName", key: "cellName", render: v => v || <Text type="secondary" style={{ fontSize: 12 }}>Unnamed Cell</Text> },
                                  { title: "Waste Type", dataIndex: "wasteType", key: "wasteType", width: 160,
                                    render: v => {
                                      const isHaz = v?.toLowerCase().includes("hazardous"); const isInert = v === "Inert";
                                      return <Tag color={isHaz ? "red" : isInert ? "blue" : "green"} style={{ fontSize: 11 }}>{v}</Tag>;
                                    }
                                  },
                                  { title: `Volume (${baselineUnit || "m³"})`, key: "vol", width: 140,
                                    render: (_, r) => <Text strong style={{ color: "#52c41a" }}>{r.volume != null ? r.volume.toLocaleString() : "—"}</Text>
                                  },
                                  !baselineSaved && { title: "", key: "act", width: 72,
                                    render: (_, r) => (
                                      <Space size={0}>
                                        <Button type="text" size="small" icon={<EditOutlined />} style={{ color: "#1a3353" }}
                                          onClick={() => { setEditingActiveCellKey(r.key); setActiveCellDraft({ cellName: r.cellName, wasteType: r.wasteType, volume: r.volume }); setActiveCellModalOpen(true); }} />
                                        <Button type="text" danger size="small" icon={<DeleteOutlined />}
                                          onClick={() => setActiveCellEntries(prev => prev.filter(e => e.key !== r.key))} />
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
                                <CloseCircleOutlined style={{ color: "#722ed1" }} />
                                <Text strong style={{ color: "#391085" }}>
                                  Closed Cells{closedCellEntries.length > 0 ? ` (${closedCellEntries.length})` : ""}
                                </Text>
                                {closedCellEntries.length > 0 && (
                                  <Text type="secondary" style={{ fontSize: 11 }}>
                                    Total: {closedCellEntries.reduce((s, e) => s + (e.volume || 0), 0).toLocaleString()} {baselineUnit || "m³"}
                                  </Text>
                                )}
                              </Space>
                            ),
                            extra: !baselineSaved && (
                              <Button size="small" icon={<PlusOutlined />} onClick={(e) => { e.stopPropagation(); setEditingClosedCellKey(null); setClosedCellDraft({ cellName: "", wasteType: "Residual", volume: null }); setClosedCellModalOpen(true); }}>
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
                                locale={{ emptyText: <Text type="secondary" style={{ fontSize: 12 }}>No entries yet.{!baselineSaved && " Click \"Add Entry\" above to add cell data."}</Text> }}
                                columns={[
                                  { title: "#", key: "idx", width: 42, render: (_, __, i) => <Text style={{ fontSize: 12, color: "#8c8c8c" }}>{i + 1}</Text> },
                                  { title: "Cell Name", dataIndex: "cellName", key: "cellName", render: v => v || <Text type="secondary" style={{ fontSize: 12 }}>Unnamed Cell</Text> },
                                  { title: "Waste Type", dataIndex: "wasteType", key: "wasteType", width: 160,
                                    render: v => {
                                      const isHaz = v?.toLowerCase().includes("hazardous"); const isInert = v === "Inert";
                                      return <Tag color={isHaz ? "red" : isInert ? "purple" : "orange"} style={{ fontSize: 11 }}>{v}</Tag>;
                                    }
                                  },
                                  { title: `Volume (${baselineUnit || "m³"})`, key: "vol", width: 140,
                                    render: (_, r) => <Text strong style={{ color: "#722ed1" }}>{r.volume != null ? r.volume.toLocaleString() : "—"}</Text>
                                  },
                                  !baselineSaved && { title: "", key: "act", width: 72,
                                    render: (_, r) => (
                                      <Space size={0}>
                                        <Button type="text" size="small" icon={<EditOutlined />} style={{ color: "#1a3353" }}
                                          onClick={() => { setEditingClosedCellKey(r.key); setClosedCellDraft({ cellName: r.cellName, wasteType: r.wasteType, volume: r.volume }); setClosedCellModalOpen(true); }} />
                                        <Button type="text" danger size="small" icon={<DeleteOutlined />}
                                          onClick={() => setClosedCellEntries(prev => prev.filter(e => e.key !== r.key))} />
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
                                <TeamOutlined style={{ color: "#614700" }} />
                                <Text strong style={{ color: "#614700" }}>
                                  Accredited Haulers{haulers.length > 0 ? ` (${haulers.length})` : ""}
                                </Text>
                              </Space>
                            ),
                            children: (
                              <div>
                                <div style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                                    onClick={() => openUploadGuide("hauler")}
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
                                      <Text type="secondary" style={{ fontSize: 13 }}>
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
                        <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #e8e8e8", display: "flex", justifyContent: "flex-end" }}>
                          <Button
                            type="primary"
                            size="large"
                            icon={<SaveOutlined />}
                            loading={baselineSavingLoading}
                            onClick={handleSaveBaselinePortal}
                            style={{ background: "#1a3353", borderColor: "#1a3353", paddingLeft: 28, paddingRight: 28 }}
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
                    {isMobile ? "Waste Generator Info" : "Waste Generator Information"}
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
                          <DatePicker format="MM/DD/YYYY" style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                    </Row>

                    {/* ── Transport & Disposal Information ── */}
                    <div style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 10, overflow: "hidden", marginTop: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "linear-gradient(90deg, #1a3353 0%, #244b7a 100%)", flexWrap: "wrap" }}>
                        <div style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <CarOutlined style={{ color: "#fff", fontSize: 14 }} />
                        </div>
                        <Text strong style={{ color: "#fff", fontSize: 13 }}>Transport &amp; Disposal Information</Text>
                        <Badge count={trucks.length} showZero style={{ backgroundColor: trucks.length > 0 ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.12)", color: "#fff", border: "none", boxShadow: "none" }} />
                        {trucks.length > 0 && (
                          <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 11, marginLeft: 2 }}>
                            · Total: <strong style={{ color: "#fff" }}>{trucks.reduce((s, t) => s + (t.actualVolume || 0), 0).toLocaleString()}</strong> {trucks[0]?.actualVolumeUnit || "tons"}
                          </Text>
                        )}
                        <Space style={{ marginLeft: "auto" }} wrap>
                          <Button size="small" type="primary" icon={<PlusOutlined />} className="slf-primary-btn" onClick={() => openTruckModal(null)}>
                            Add Entry
                          </Button>
                          <Button size="small" icon={<UploadOutlined />} style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff" }} onClick={() => openUploadGuide("truck")}>
                            Upload Excel/CSV
                          </Button>
                        </Space>
                      </div>
                      <div style={{ padding: trucks.length === 0 ? 0 : "10px 12px" }}>
                        {trucks.length === 0 ? (
                          <div style={{ textAlign: "center", padding: "28px 16px", background: "#fafafa" }}>
                            <CarOutlined style={{ fontSize: 28, color: "#d9d9d9", display: "block", marginBottom: 8 }} />
                            <Text type="secondary" style={{ fontSize: 13 }}>No entries added. Click &quot;Add Entry&quot; to add transport data.</Text>
                          </div>
                        ) : (
                          <Collapse
                            bordered={false}
                            style={{ background: "transparent" }}
                            expandIconPlacement="start"
                            items={trucks.map((t, i) => {
                              const vehs = t.vehicles || [];
                              const plateNos = vehs.map(v => v.plateNumber).filter(Boolean).join(", ") || t.plateNumber || "—";
                              const capacities = vehs.length > 0
                                ? vehs.filter(v => v.capacity != null).map(v => `${v.capacity} ${(v.capacityUnit || "m³").replace("m3", "m³")}`).join(", ")
                                : t.truckCapacity != null ? `${t.truckCapacity} ${(t.truckCapacityUnit || "m³").replace("m3", "m³")}` : "—";
                              const isHaz = t.wasteType?.toLowerCase().includes("hazardous");
                              const allClients = vehs.flatMap(v => v.selectedClients || []);
                              return {
                                key: t.key,
                                style: { marginBottom: 6, borderRadius: 8, border: "1px solid #e8e8e8", background: "#fff", overflow: "hidden" },
                                label: (
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", width: "100%", paddingRight: 4 }}>
                                    <div style={{ width: 22, height: 22, borderRadius: 5, background: "#1a3353", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                      <Text style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>{i + 1}</Text>
                                    </div>
                                    <Text strong style={{ fontSize: 13, color: "#1a3353", flexShrink: 0, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {t.disposalTicketNo || <Text type="secondary" style={{ fontWeight: 400, fontSize: 12 }}>No Ticket No.</Text>}
                                    </Text>
                                    {t.hauler && <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>{t.hauler}</Tag>}
                                    {t.wasteType && <Tag color={isHaz ? "red" : "green"} style={{ margin: 0, fontSize: 11 }}>{t.wasteType}</Tag>}
                                    {t.actualVolume != null && (
                                      <Tag color="orange" style={{ margin: 0, fontSize: 11, marginLeft: "auto" }}>
                                        {t.actualVolume} {t.actualVolumeUnit || "tons"}
                                      </Tag>
                                    )}
                                  </div>
                                ),
                                extra: (
                                  <Space size={0} onClick={e => e.stopPropagation()}>
                                    <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openTruckModal(t)} style={{ color: "#1a3353" }} />
                                    <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeTruck(t.key)} />
                                  </Space>
                                ),
                                children: (
                                  <div style={{ padding: "4px 4px 8px" }}>
                                    <Row gutter={[10, 8]}>
                                      {t.lguCompanyName && (
                                        <Col xs={24} sm={12} md={8}>
                                          <div style={{ background: "#f8faff", borderRadius: 6, padding: "6px 10px" }}>
                                            <div style={{ fontSize: 10, color: "#8c8c8c", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>LGU / Company</div>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: "#262626", marginTop: 2 }}>{t.lguCompanyName}</div>
                                          </div>
                                        </Col>
                                      )}
                                      {t.companyType && (
                                        <Col xs={12} sm={6} md={4}>
                                          <div style={{ background: "#f8faff", borderRadius: 6, padding: "6px 10px" }}>
                                            <div style={{ fontSize: 10, color: "#8c8c8c", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Type</div>
                                            <Tag color={t.companyType === "LGU" ? "blue" : "green"} style={{ margin: "4px 0 0", fontWeight: 600 }}>{t.companyType}</Tag>
                                          </div>
                                        </Col>
                                      )}
                                      <Col xs={12} sm={6} md={4}>
                                        <div style={{ background: "#f8faff", borderRadius: 6, padding: "6px 10px" }}>
                                          <div style={{ fontSize: 10, color: "#8c8c8c", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Plate No.</div>
                                          <div style={{ fontSize: 12, fontWeight: 600, color: "#262626", marginTop: 2 }}>{plateNos}</div>
                                        </div>
                                      </Col>
                                      <Col xs={12} sm={6} md={4}>
                                        <div style={{ background: "#f8faff", borderRadius: 6, padding: "6px 10px" }}>
                                          <div style={{ fontSize: 10, color: "#8c8c8c", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Capacity</div>
                                          <div style={{ fontSize: 12, fontWeight: 600, color: "#262626", marginTop: 2 }}>{capacities}</div>
                                        </div>
                                      </Col>
                                      <Col xs={12} sm={6} md={4}>
                                        <div style={{ background: "#fff7e6", borderRadius: 6, padding: "6px 10px", border: "1px solid #ffe7ba" }}>
                                          <div style={{ fontSize: 10, color: "#8c8c8c", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Actual Volume</div>
                                          <div style={{ fontSize: 14, fontWeight: 700, color: "#fa8c16", marginTop: 2 }}>
                                            {t.actualVolume != null ? `${t.actualVolume} ${t.actualVolumeUnit || "tons"}` : "—"}
                                          </div>
                                        </div>
                                      </Col>
                                      {isHaz && t.hazWasteCode && (Array.isArray(t.hazWasteCode) ? t.hazWasteCode : [t.hazWasteCode]).length > 0 && (
                                        <Col xs={24}>
                                          <div style={{ background: "#fff1f0", borderRadius: 6, padding: "6px 10px", border: "1px solid #ffa39e" }}>
                                            <div style={{ fontSize: 10, color: "#8c8c8c", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, marginBottom: 4 }}>Haz. Waste Code(s)</div>
                                            {(Array.isArray(t.hazWasteCode) ? t.hazWasteCode : [t.hazWasteCode]).map(code => (
                                              <Tag key={code} color="red" style={{ fontSize: 11, marginBottom: 2 }}>{code}</Tag>
                                            ))}
                                          </div>
                                        </Col>
                                      )}
                                      {allClients.length > 0 && (
                                        <Col xs={24}>
                                          <div style={{ background: "#f6ffed", borderRadius: 6, padding: "6px 10px", border: "1px solid #b7eb8f" }}>
                                            <div style={{ fontSize: 10, color: "#8c8c8c", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, marginBottom: 4 }}>Clients ({allClients.length})</div>
                                            {allClients.map((c, ci) => {
                                              const name = typeof c === "string" ? c : c.clientName;
                                              const type = typeof c === "string" ? null : c.clientType;
                                              return <Tag key={ci} color={type === "LGU" ? "blue" : "green"} style={{ fontSize: 11, marginBottom: 2 }}>{name}{type ? ` (${type})` : ""}</Tag>;
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
      </div>
    );
  };

  // ── My Requests Content ──
  const REQUEST_TYPE_MAP = {
    baseline_update_request: { label: "Baseline Update Request", color: "blue" },
    baseline_update_approved: { label: "Baseline Update Approved", color: "green" },
    submission_edit_request: { label: "Edit Request", color: "blue" },
    submission_edit_approved: { label: "Edit Approved", color: "green" },
    submission_edit_rejected: { label: "Edit Rejected", color: "red" },
    support_ticket: { label: "Support Ticket", color: "purple" },
    support_ticket_reply: { label: "Support Reply", color: "cyan" },
  };

  const renderRequests = () => (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
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
                v ? new Date(v).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "—",
            },
            {
              title: "Type",
              dataIndex: "type",
              key: "type",
              width: 200,
              filters: Object.entries(REQUEST_TYPE_MAP).map(([val, { label }]) => ({
                text: label,
                value: val,
              })),
              onFilter: (value, record) => record.type === value,
              render: (t) => {
                const cfg = REQUEST_TYPE_MAP[t] || { label: t, color: "default" };
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
                const rejected = type.includes("rejected") || record.meta?.action === "rejected";
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
                      (t.companyName === company || t.meta?.slfName === company) &&
                      (t.type === `${resolutionType}_approved` || t.type === `${resolutionType}_rejected` || t.meta?.action === "rejected")
                  );
                  if (resolved) {
                    if (resolved.type.includes("approved")) return <Tag color="green">APPROVED</Tag>;
                    if (resolved.type.includes("rejected") || resolved.meta?.action === "rejected") return <Tag color="red">REJECTED</Tag>;
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
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
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
            <div style={{
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
            }}>
              <WifiOutlined />
              You are currently offline. Some features may be unavailable. Data will be sent once your connection is restored.
            </div>
          )}
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
      </Layout>

      {/* ── Hauler Modal ── */}
      <Modal
        title={
          editingHaulerKey ? "Edit Accredited Hauler" : "Add Accredited Hauler"
        }
        open={haulerModalOpen}
        onCancel={() => {
          setHaulerModalOpen(false);
          setHaulerErrors({});
        }}
        onOk={handleSaveHauler}
        okText={editingHaulerKey ? "Update" : "Add"}
        okButtonProps={{ className: "slf-primary-btn" }}
        destroyOnHidden
        width={1100}
      >
        <Collapse
          defaultActiveKey={["basic", "vehicle", "clients"]}
          bordered={false}
          expandIconPlacement="end"
          style={{ background: "transparent" }}
          items={[
            {
              key: "basic",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <TeamOutlined /> Basic Information
                </Text>
              ),
              children: (
                <>
                  <Row gutter={[12, 0]}>
                    <Col xs={24} sm={14}>
                      <Form.Item
                        label="Accredited Hauler"
                        required
                        {...haulerFieldErr("haulerName")}
                      >
                        <Input
                          placeholder="Hauler name"
                          value={haulerDraft.haulerName}
                          onChange={(e) =>
                            updateHaulerDraft("haulerName", e.target.value)
                          }
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={10}>
                      <Form.Item
                        label="Number of Trucks"
                        required
                        {...haulerFieldErr("numberOfTrucks")}
                      >
                        <InputNumber
                          placeholder="Count"
                          style={{ width: "100%" }}
                          min={1}
                          value={haulerDraft.numberOfTrucks}
                          onChange={(v) =>
                            updateHaulerDraft("numberOfTrucks", v)
                          }
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={[12, 0]}>
                    <Col xs={24} sm={12}>
                      <Form.Item label="Region">
                        <Select
                          showSearch
                          placeholder="Select region"
                          value={haulerDraft.officeRegion || undefined}
                          onChange={(code) => {
                            updateHaulerDraft("officeRegion", code);
                            fetchHaulerProvinces(code);
                          }}
                          filterOption={(input, opt) => opt?.label?.toLowerCase().includes(input.toLowerCase())}
                          options={regions.map(r => ({ value: r.code, label: r.name }))}
                          allowClear
                          style={{ width: "100%" }}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item label="Province">
                        <Select
                          showSearch
                          placeholder="Select province"
                          value={haulerDraft.officeProvince || undefined}
                          loading={loadingHaulerAddress === "province"}
                          disabled={!haulerDraft.officeRegion}
                          onChange={(code) => {
                            updateHaulerDraft("officeProvince", code);
                            fetchHaulerCities(code);
                          }}
                          filterOption={(input, opt) => opt?.label?.toLowerCase().includes(input.toLowerCase())}
                          options={haulerProvinces.map(p => ({ value: p.code, label: p.name }))}
                          allowClear
                          style={{ width: "100%" }}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item label="City / Municipality">
                        <Select
                          showSearch
                          placeholder="Select city/municipality"
                          value={haulerDraft.officeCity || undefined}
                          loading={loadingHaulerAddress === "city"}
                          disabled={!haulerDraft.officeProvince}
                          onChange={(code) => {
                            updateHaulerDraft("officeCity", code);
                            fetchHaulerBarangays(code);
                          }}
                          filterOption={(input, opt) => opt?.label?.toLowerCase().includes(input.toLowerCase())}
                          options={haulerCities.map(c => ({ value: c.code, label: c.name }))}
                          allowClear
                          style={{ width: "100%" }}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item label="Barangay">
                        <Select
                          showSearch
                          placeholder="Select barangay"
                          value={haulerDraft.officeBarangay || undefined}
                          loading={loadingHaulerAddress === "barangay"}
                          disabled={!haulerDraft.officeCity}
                          onChange={(code) => updateHaulerDraft("officeBarangay", code)}
                          filterOption={(input, opt) => opt?.label?.toLowerCase().includes(input.toLowerCase())}
                          options={haulerBarangayList.map(b => ({ value: b.code, label: b.name }))}
                          allowClear
                          style={{ width: "100%" }}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              ),
            },
            {
              key: "vehicle",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <CarOutlined /> Vehicle Details
                  {haulerDraft.vehicles?.length > 0 && (
                    <Tag color="blue" style={{ marginLeft: 8 }}>
                      {haulerDraft.vehicles.length}
                    </Tag>
                  )}
                </Text>
              ),
              children:
                haulerDraft.vehicles?.length > 0 ? (
                  haulerDraft.vehicles.map((v, i) => (
                    <div
                      key={i}
                      style={{
                        marginBottom: 12,
                        padding: "8px 12px",
                        background: "#fafafa",
                        borderRadius: 6,
                        border: "1px solid #f0f0f0",
                      }}
                    >
                      <Text
                        strong
                        style={{
                          fontSize: 12,
                          color: "#1a3353",
                          display: "block",
                          marginBottom: 8,
                        }}
                      >
                        Vehicle {i + 1}
                      </Text>
                      <Row gutter={[12, 0]}>
                        <Col xs={24} sm={8}>
                          <Form.Item label="Plate Number" style={{ marginBottom: 8 }}>
                            <Input
                              placeholder="e.g. ABC-1234"
                              value={v.plateNumber}
                              onChange={(e) =>
                                updateVehicle(i, "plateNumber", e.target.value)
                              }
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                          <Form.Item label="Vehicle Type" style={{ marginBottom: 8 }}>
                            <Input
                              placeholder="e.g. Dump Truck"
                              value={v.vehicleType}
                              onChange={(e) =>
                                updateVehicle(i, "vehicleType", e.target.value)
                              }
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={5}>
                          <Form.Item label="Capacity" style={{ marginBottom: 8 }}>
                            <InputNumber
                              placeholder="Cap."
                              style={{ width: "100%" }}
                              min={0}
                              step={0.1}
                              value={v.capacity}
                              onChange={(val) =>
                                updateVehicle(i, "capacity", val)
                              }
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={3}>
                          <Form.Item label="Unit" style={{ marginBottom: 8 }}>
                            <Select
                              value={v.capacityUnit}
                              onChange={(val) =>
                                updateVehicle(i, "capacityUnit", val)
                              }
                            >
                              <Option value="m³">
                                m<sup>3</sup>
                              </Option>
                              <Option value="tons">tons</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                      </Row>
                    </div>
                  ))
                ) : (
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    Set the Number of Trucks above to add vehicle details.
                  </Text>
                ),
            },
            {
              key: "clients",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <EnvironmentOutlined /> Clients
                </Text>
              ),
              children: (
                <div>
                  <div style={{ marginBottom: 8 }}>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      className="slf-primary-btn"
                      size="small"
                      onClick={() => {
                        setEditingClientKey(null);
                        setClientDraft({ clientName: "", clientType: "Private", region: "", province: "", municipality: "" });
                        setClientProvinces([]);
                        setClientMunicipalities([]);
                        setClientModalOpen(true);
                      }}
                    >
                      Add Client
                    </Button>
                  </div>
                  <Table
                    dataSource={haulerDraft.privateSectorClients || []}
                    rowKey="key"
                    size="small"
                    pagination={false}
                    locale={{ emptyText: <Text type="secondary" style={{ fontSize: 12 }}>No clients added yet.</Text> }}
                    columns={[
                      { title: "Client Name", dataIndex: "clientName", key: "clientName", render: v => v || "—" },
                      {
                        title: "Type", dataIndex: "clientType", key: "clientType", width: 80,
                        render: v => <Tag color={v === "LGU" ? "blue" : "green"}>{v}</Tag>
                      },
                      {
                        title: "Location", key: "location",
                        render: (_, r) => [
                          r.regionName || r.region,
                          r.provinceName || r.province,
                          r.municipalityName || r.municipality,
                        ].filter(Boolean).join(" / ") || "—"
                      },
                      {
                        title: "Actions", key: "act", width: 80,
                        render: (_, r) => (
                          <Space size="small">
                            <Button type="text" size="small" icon={<EditOutlined />}
                              onClick={async () => {
                                setEditingClientKey(r.key);
                                setClientDraft({ clientName: r.clientName, clientType: r.clientType, region: r.region, province: r.province, municipality: r.municipality });
                                setClientProvinces([]);
                                setClientMunicipalities([]);
                                if (r.region) {
                                  setLoadingClientAddress("province");
                                  try {
                                    const res = await fetch(`https://psgc.gitlab.io/api/regions/${r.region}/provinces/`);
                                    setClientProvinces(await res.json());
                                  } catch (_) {}
                                  setLoadingClientAddress("");
                                }
                                if (r.province) {
                                  setLoadingClientAddress("municipality");
                                  try {
                                    const res = await fetch(`https://psgc.gitlab.io/api/provinces/${r.province}/cities-municipalities/`);
                                    setClientMunicipalities(await res.json());
                                  } catch (_) {}
                                  setLoadingClientAddress("");
                                }
                                setClientModalOpen(true);
                              }}
                              style={{ color: "#1a3353" }}
                            />
                            <Button type="text" danger size="small" icon={<DeleteOutlined />}
                              onClick={() => updateHaulerDraft("privateSectorClients", (haulerDraft.privateSectorClients || []).filter(c => c.key !== r.key))}
                            />
                          </Space>
                        ),
                      },
                    ]}
                  />
                </div>
              ),
            },
          ]}
        />
      </Modal>

      {/* ── Truck Entry Modal ── */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 12, paddingRight: 32 }}>
            <div style={{ background: "linear-gradient(135deg, #1a3353 0%, #1e4a7a 100%)", borderRadius: 10, width: 42, height: 42, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 2px 8px rgba(26,51,83,0.35)" }}>
              <CarOutlined style={{ color: "#fff", fontSize: 20 }} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1a3353", lineHeight: 1.3, letterSpacing: 0.2 }}>
                {editingTruckKey ? "Edit Transport Entry" : "Add Transport Entry"}
              </div>
              <div style={{ fontSize: 11, color: "#8c8c8c", fontWeight: 400, marginTop: 2 }}>
                Complete all sections below for this transport trip
              </div>
            </div>
          </div>
        }
        open={truckModalOpen}
        onCancel={() => {
          setTruckModalOpen(false);
          setTruckErrors({});
        }}
        onOk={handleSaveTruck}
        okText={editingTruckKey ? "Update Entry" : "Add Entry"}
        okButtonProps={{ className: "slf-primary-btn", icon: editingTruckKey ? <EditOutlined /> : <PlusOutlined /> }}
        cancelButtonProps={{ icon: <CloseCircleOutlined /> }}
        destroyOnHidden
        width={880}
        styles={{ body: { paddingTop: 16, maxHeight: "72vh", overflowY: "auto" } }}
      >
        {/* ── Section 1: Company Information ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "linear-gradient(90deg, #1a3353 0%, #244b7a 100%)", borderRadius: "8px 8px 0 0", padding: "9px 16px" }}>
          <BankOutlined style={{ color: "#fff", fontSize: 14 }} />
          <Text strong style={{ color: "#fff", fontSize: 13, letterSpacing: 0.3 }}>Company Information</Text>
        </div>
        <div style={{ background: "#f8faff", border: "1px solid #d6e4ff", borderTop: "none", borderRadius: "0 0 8px 8px", padding: "16px 16px 4px", marginBottom: 14 }}>
          <Row gutter={[12, 0]}>
            <Col xs={24} sm={13} md={11}>
              <Form.Item label="LGU/Company Name" required>
                <Input
                  placeholder="e.g. City of Manila LGU"
                  value={truckDraft.lguCompanyName}
                  onChange={e => updateTruckDraft("lguCompanyName", e.target.value)}
                  prefix={<BankOutlined style={{ color: "#bfbfbf" }} />}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={11} md={8}>
              <Form.Item label="Company Type" required>
                <Select
                  placeholder="Select type"
                  style={{ width: "100%" }}
                  value={truckDraft.companyType || undefined}
                  onChange={v => updateTruckDraft("companyType", v)}
                  options={[
                    { label: "🏛 LGU", value: "LGU" },
                    { label: "🏢 Private", value: "Private" },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item label="Address">
                <Input
                  placeholder="Complete business address"
                  value={truckDraft.address}
                  onChange={e => updateTruckDraft("address", e.target.value)}
                  prefix={<EnvironmentOutlined style={{ color: "#bfbfbf" }} />}
                />
              </Form.Item>
            </Col>
          </Row>
        </div>

        {/* ── Section 2: Trip Information ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "linear-gradient(90deg, #135200 0%, #237804 100%)", borderRadius: "8px 8px 0 0", padding: "9px 16px" }}>
          <AuditOutlined style={{ color: "#fff", fontSize: 14 }} />
          <Text strong style={{ color: "#fff", fontSize: 13, letterSpacing: 0.3 }}>Trip Information</Text>
        </div>
        <div style={{ background: "#f6ffed", border: "1px solid #b7eb8f", borderTop: "none", borderRadius: "0 0 8px 8px", padding: "16px 16px 4px", marginBottom: 14 }}>
          <Row gutter={[12, 0]}>
            <Col xs={24} sm={12}>
              <Form.Item
                label={fl("disposalTicketNo", "Disposal/Trip Ticket No.")}
                required
                {...fieldErr("disposalTicketNo")}
              >
                <Input
                  placeholder="e.g. TK-2024-001"
                  value={truckDraft.disposalTicketNo}
                  onChange={(e) => updateTruckDraft("disposalTicketNo", e.target.value)}
                  prefix={<FileTextOutlined style={{ color: "#bfbfbf" }} />}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                label={fl("hauler", "Hauler")}
                required={isRequired("hauler", true)}
                {...fieldErr("hauler")}
              >
                <Select
                  showSearch
                  allowClear
                  placeholder="Select accredited hauler"
                  value={truckDraft.hauler || undefined}
                  onChange={(v) => {
                    updateTruckDraft("hauler", v || "");
                    updateTruckDraft("plateNumber", "");
                    updateTruckDraft("truckCapacity", null);
                    updateTruckDraft("vehicles", [{ ...EMPTY_VEHICLE, key: Date.now(), capacityUnit: baselineUnit || "m³" }]);
                  }}
                  filterOption={(input, option) =>
                    (option?.children ?? "").toLowerCase().includes(input.toLowerCase())
                  }
                  notFoundContent={<Text type="secondary" style={{ fontSize: 12 }}>No haulers registered in baseline</Text>}
                >
                  {haulers.map((h) => (
                    <Option key={h.key || h.haulerName} value={h.haulerName}>
                      {h.haulerName}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
        </div>

        {/* ── Section 3: Vehicle & Capacity ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "linear-gradient(90deg, #612500 0%, #873800 100%)", borderRadius: "8px 8px 0 0", padding: "9px 16px" }}>
          <CarOutlined style={{ color: "#fff", fontSize: 14 }} />
          <Text strong style={{ color: "#fff", fontSize: 13, letterSpacing: 0.3 }}>Vehicle & Capacity</Text>
        </div>
        <div style={{ background: "#fff7e6", border: "1px solid #ffd591", borderTop: "none", borderRadius: "0 0 8px 8px", padding: "16px 16px 4px", marginBottom: 14 }}>
          {truckErrors.plateNumber && (
            <Text type="danger" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>{truckErrors.plateNumber}</Text>
          )}
          {(truckDraft.vehicles || []).map((veh, vi) => {
            const selectedHauler = haulers.find((h) => h.haulerName === truckDraft.hauler);
            const haulerVehicles = selectedHauler?.vehicles || [];
            return (
              <div key={veh.key || vi} style={{ background: "#fff", borderRadius: 8, padding: "12px 14px", marginBottom: 10, border: "1px solid #ffd591", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Vehicle {vi + 1}
                  </Text>
                  {(truckDraft.vehicles || []).length > 1 && (
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => {
                        const updated = (truckDraft.vehicles || []).filter((_, idx) => idx !== vi);
                        updateTruckDraft("vehicles", updated);
                      }}
                    />
                  )}
                </div>
                <Row gutter={[12, 0]} align="middle">
                  <Col xs={24} sm={10}>
                    <Form.Item label={fl("plateNumber", "Plate Number")} style={{ marginBottom: 4 }}>
                      <Select
                        showSearch
                        allowClear
                        placeholder="Select or type plate number"
                        value={veh.plateNumber || undefined}
                        onChange={(val) => {
                          const updated = [...(truckDraft.vehicles || [])];
                          updated[vi] = { ...updated[vi], plateNumber: val || "", selectedClients: [] };
                          const match = haulerVehicles.find((hv) => hv.plateNumber === val);
                          if (match) {
                            updated[vi].capacity = match.capacity || null;
                            updated[vi].capacityUnit = match.capacityUnit || baselineUnit || "m³";
                          }
                          updateTruckDraft("vehicles", updated);
                        }}
                        filterOption={(input, option) =>
                          (option?.children ?? "").toLowerCase().includes(input.toLowerCase())
                        }
                        notFoundContent={truckDraft.hauler ? "No vehicles for this hauler" : "Select a hauler first"}
                      >
                        {haulerVehicles.map((hv) => (
                          <Option key={hv.plateNumber} value={hv.plateNumber}>
                            {hv.plateNumber}
                          </Option>
                        ))}
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col xs={14} sm={9}>
                    <Form.Item label="Truck Capacity" style={{ marginBottom: 4 }}>
                      <InputNumber
                        placeholder="Capacity"
                        style={{ width: "100%" }}
                        min={0}
                        step={0.1}
                        value={veh.capacity}
                        onChange={(val) => {
                          const updated = [...(truckDraft.vehicles || [])];
                          updated[vi] = { ...updated[vi], capacity: val };
                          updateTruckDraft("vehicles", updated);
                        }}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={10} sm={5}>
                    <Form.Item label="Unit" style={{ marginBottom: 4 }}>
                      <Select
                        value={veh.capacityUnit || baselineUnit || "m³"}
                        onChange={(val) => {
                          const updated = [...(truckDraft.vehicles || [])];
                          updated[vi] = { ...updated[vi], capacityUnit: val };
                          updateTruckDraft("vehicles", updated);
                        }}
                      >
                        <Option value="m³">m³</Option>
                        <Option value="tons">tons</Option>
                      </Select>
                    </Form.Item>
                  </Col>
                  {(() => {
                    const selectedHauler = haulers.find(h => h.haulerName === truckDraft.hauler);
                    const haulerClients = selectedHauler?.privateSectorClients || [];
                    if (!haulerClients.length || !veh.plateNumber) return null;
                    return (
                      <Col xs={24}>
                        <Form.Item
                          label={<Text style={{ fontSize: 12 }}><TeamOutlined style={{ marginRight: 4 }} />Clients for this Vehicle</Text>}
                          style={{ marginBottom: 4, marginTop: 4 }}
                        >
                          <Select
                            mode="multiple"
                            placeholder="Select clients for this vehicle"
                            value={(veh.selectedClients || []).map(c => typeof c === "object" ? c.clientName : c)}
                            onChange={vals => {
                              const selected = vals.map(name => {
                                const found = haulerClients.find(c => (c.clientName || c) === name);
                                if (found && typeof found === "object") return { ...found, key: found.key || name };
                                return { clientName: name, clientType: "Private", region: "", province: "", municipality: "", key: name };
                              });
                              const updated = [...(truckDraft.vehicles || [])];
                              updated[vi] = { ...updated[vi], selectedClients: selected };
                              updateTruckDraft("vehicles", updated);
                            }}
                            options={haulerClients.map(c => ({
                              label: typeof c === "object"
                                ? <span>{c.clientName} <Tag color={c.clientType === "LGU" ? "blue" : "green"} style={{ fontSize: 10, marginLeft: 4 }}>{c.clientType}</Tag></span>
                                : c,
                              value: typeof c === "object" ? c.clientName : c,
                            }))}
                          />
                        </Form.Item>
                      </Col>
                    );
                  })()}
                </Row>
              </div>
            );
          })}
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => {
              const updated = [...(truckDraft.vehicles || []), { ...EMPTY_VEHICLE, key: Date.now(), capacityUnit: baselineUnit || "m³", selectedClients: [] }];
              updateTruckDraft("vehicles", updated);
            }}
            style={{ marginTop: 4, borderColor: "#fa8c16", color: "#fa8c16" }}
          >
            Add Vehicle
          </Button>
        </div>

        {/* ── Section 4: Waste Details ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "linear-gradient(90deg, #391085 0%, #531dab 100%)", borderRadius: "8px 8px 0 0", padding: "9px 16px" }}>
          <DatabaseOutlined style={{ color: "#fff", fontSize: 14 }} />
          <Text strong style={{ color: "#fff", fontSize: 13, letterSpacing: 0.3 }}>Waste Details</Text>
        </div>
        <div style={{ background: "#f9f0ff", border: "1px solid #d3adf7", borderTop: "none", borderRadius: "0 0 8px 8px", padding: "16px 16px 4px", marginBottom: extraTransportFields.length > 0 ? 14 : 0 }}>
          <Row gutter={[12, 0]}>
            <Col xs={12} sm={8}>
              <Form.Item
                label={fl("actualVolume", "Actual Waste Volume")}
                required={isRequired("actualVolume", true)}
                {...fieldErr("actualVolume")}
              >
                <InputNumber
                  placeholder="Volume"
                  style={{ width: "100%" }}
                  min={0}
                  step={0.01}
                  value={truckDraft.actualVolume}
                  onChange={(v) => updateTruckDraft("actualVolume", v)}
                />
              </Form.Item>
            </Col>
            <Col xs={12} sm={4}>
              <Form.Item label="Unit">
                <Select
                  value={truckDraft.actualVolumeUnit}
                  onChange={(v) => updateTruckDraft("actualVolumeUnit", v)}
                >
                  <Option value="tons">tons</Option>
                  <Option value="m³">m³</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                label={fl("wasteType", "Waste Type")}
                required={isRequired("wasteType", true)}
                {...fieldErr("wasteType")}
              >
                <Select
                  placeholder="Select waste classification"
                  value={truckDraft.wasteType}
                  onChange={(v) => updateTruckDraft("wasteType", v)}
                >
                  {opts("wasteType", ["Residual", "Treated Hazardous Waste"]).map((o) => (
                    <Option key={o} value={o}>{o}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={[12, 0]}>
            <Col xs={24} sm={14}>
              <Form.Item
                label="Hazardous Waste Code (DENR EMB)"
                tooltip="Applicable only for Treated Hazardous Waste"
              >
                <Select
                  mode="multiple"
                  placeholder="Select DENR EMB hazardous waste code(s)"
                  value={truckDraft.hazWasteCode}
                  onChange={(v) => updateTruckDraft("hazWasteCode", v)}
                  disabled={!truckDraft.wasteType?.toLowerCase().includes("hazardous")}
                  showSearch
                  allowClear
                >
                  {hazWasteCodes.map((code) => (
                    <Option key={code} value={code}>{code}</Option>
                  ))}
                </Select>
                {!truckDraft.wasteType?.toLowerCase().includes("hazardous") && (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    Select &quot;Treated Hazardous Waste&quot; as Waste Type to enable this field.
                  </Text>
                )}
              </Form.Item>
            </Col>
          </Row>
        </div>

        {/* ── Section 5: Additional Fields (if any) ── */}
        {extraTransportFields.length > 0 && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "linear-gradient(90deg, #003a8c 0%, #0050b3 100%)", borderRadius: "8px 8px 0 0", padding: "9px 16px" }}>
              <ContainerOutlined style={{ color: "#fff", fontSize: 14 }} />
              <Text strong style={{ color: "#fff", fontSize: 13, letterSpacing: 0.3 }}>Additional Fields</Text>
            </div>
            <div style={{ background: "#f0f5ff", border: "1px solid #adc6ff", borderTop: "none", borderRadius: "0 0 8px 8px", padding: "16px 16px 4px" }}>
              <Row gutter={[12, 0]}>
                {extraTransportFields.map((f) => (
                  <Col xs={24} sm={12} key={f.fieldKey}>
                    <Form.Item
                      label={f.fieldName}
                      required={f.required}
                      {...fieldErr(f.fieldKey)}
                    >
                      {f.fieldType === "number" ? (
                        <InputNumber
                          placeholder={f.fieldName}
                          style={{ width: "100%" }}
                          min={0}
                          step={0.01}
                          value={truckDraft[f.fieldKey]}
                          onChange={(v) => updateTruckDraft(f.fieldKey, v)}
                        />
                      ) : f.fieldType === "select" ? (
                        <Select
                          placeholder={`Select ${f.fieldName}`}
                          value={truckDraft[f.fieldKey] || undefined}
                          onChange={(v) => updateTruckDraft(f.fieldKey, v)}
                          allowClear
                        >
                          {(f.options || []).map((o) => (
                            <Option key={o} value={o}>{o}</Option>
                          ))}
                        </Select>
                      ) : f.fieldType === "date" ? (
                        <DatePicker
                          style={{ width: "100%" }}
                          value={truckDraft[f.fieldKey]}
                          onChange={(v) => updateTruckDraft(f.fieldKey, v)}
                        />
                      ) : f.fieldType === "textarea" ? (
                        <TextArea
                          rows={2}
                          placeholder={f.fieldName}
                          value={truckDraft[f.fieldKey]}
                          onChange={(e) => updateTruckDraft(f.fieldKey, e.target.value)}
                        />
                      ) : (
                        <Input
                          placeholder={f.fieldName}
                          value={truckDraft[f.fieldKey]}
                          onChange={(e) => updateTruckDraft(f.fieldKey, e.target.value)}
                        />
                      )}
                    </Form.Item>
                  </Col>
                ))}
              </Row>
            </div>
          </>
        )}
      </Modal>

      {/* ── Submission Detail Modal ── */}
      <Modal
        title={null}
        open={!!historyDetailModal}
        onCancel={() => setHistoryDetailModal(null)}
        footer={null}
        width={900}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
        closeIcon={<span style={{ color: "#fff", fontSize: 18, fontWeight: 700, position: "relative", zIndex: 1 }}>✕</span>}
      >
        {historyDetailModal && (() => {
          const d = historyDetailModal;
          const totalVolume = (d.trucks || []).reduce((s, t) => s + (t.actualVolume || 0), 0);
          const sectionTitle = (icon, text) => (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 15, color: "#1a3353" }}>{icon}</span>
              <Text strong style={{ fontSize: 14, color: "#1a3353", letterSpacing: 0.3 }}>{text}</Text>
            </div>
          );
          const fieldRow = (label, value, opts = {}) => (
            <Col xs={opts.span === 2 ? 24 : 12} sm={opts.span === 2 ? 24 : 12} key={label}>
              <div style={{ marginBottom: 14 }}>
                <Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 2 }}>{label}</Text>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#262626" }}>{value || "—"}</div>
              </div>
            </Col>
          );
          return (
            <div>
              {/* Header Banner */}
              <div style={{ background: "linear-gradient(135deg, #0e1e35 0%, #1a3353 100%)", padding: "24px 28px 20px", paddingRight: 48, borderRadius: "8px 8px 0 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Submission Details</Text>
                    <div style={{ marginTop: 4 }}>
                      <Text style={{ color: "#fff", fontSize: 20, fontWeight: 700, letterSpacing: 0.5 }}>{d.idNo}</Text>
                    </div>
                    <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 4, display: "block" }}>
                      {d.lguCompanyName} &middot; {d.dateOfDisposal ? dayjs(d.dateOfDisposal).format("MMMM D, YYYY") : "No date"}
                    </Text>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {renderStatusTag(d.status, d)}
                    <div style={{ marginTop: 8 }}>
                      <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>
                        Submitted {dayjs(d.createdAt).format("MMM D, YYYY h:mm A")}
                      </Text>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ padding: "24px 28px" }}>
                {/* Summary Stats Bar */}
                <Row gutter={16} style={{ marginBottom: 24 }}>
                  <Col xs={8}>
                    <div style={{ background: "#f0f5ff", borderRadius: 8, padding: "12px 16px", border: "1px solid #d6e4ff", minHeight: 72, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                      <Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Company Type</Text>
                      <div style={{ marginTop: 4 }}>
                        <Tag color={d.companyType === "LGU" ? "blue" : "green"} style={{ margin: 0, fontWeight: 600 }}>{d.companyType}</Tag>
                      </div>
                    </div>
                  </Col>
                  <Col xs={8}>
                    <div style={{ background: "#f6ffed", borderRadius: 8, padding: "12px 16px", border: "1px solid #d9f7be", minHeight: 72, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                      <Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Truck Entries</Text>
                      <div style={{ marginTop: 4 }}><Text strong style={{ fontSize: 18, color: "#52c41a" }}>{d.trucks?.length || 0}</Text></div>
                    </div>
                  </Col>
                  <Col xs={8}>
                    <div style={{ background: "#fff7e6", borderRadius: 8, padding: "12px 16px", border: "1px solid #ffe7ba", minHeight: 72, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                      <Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Total Volume</Text>
                      <div style={{ marginTop: 4 }}><Text strong style={{ fontSize: 18, color: "#fa8c16" }}>{totalVolume > 0 ? totalVolume.toLocaleString() : "0"}</Text> <Text type="secondary" style={{ fontSize: 11 }}>tons</Text></div>
                    </div>
                  </Col>
                </Row>

                <Collapse
                  defaultActiveKey={["company", "transport"]}
                  bordered={false}
                  size="small"
                  style={{ background: "transparent" }}
                  items={[
                    {
                      key: "company",
                      label: <Text strong style={{ fontSize: 13 }}><EnvironmentOutlined style={{ color: "#1a3353", marginRight: 6 }} />Company & Disposal Information</Text>,
                      children: (
                        <Row gutter={16}>
                          {fieldRow("Company / LGU Name", d.lguCompanyName)}
                          {fieldRow("Company Type", <Tag color={d.companyType === "LGU" ? "blue" : "green"} bordered={false}>{d.companyType}</Tag>)}
                          {fieldRow("Address", d.address, { span: 2 })}
                          {fieldRow("Date of Disposal", d.dateOfDisposal ? dayjs(d.dateOfDisposal).format("MMMM D, YYYY") : null)}
                          {fieldRow("Submission ID", <Text copyable style={{ fontSize: 12, fontFamily: "monospace" }}>{d.submissionId || "—"}</Text>)}
                        </Row>
                      ),
                    },
                    {
                      key: "baseline",
                      label: <Text strong style={{ fontSize: 13 }}><DatabaseOutlined style={{ color: "#1a3353", marginRight: 6 }} />Baseline Data</Text>,
                      children: (
                        <Row gutter={16}>
                          {fieldRow("Total Volume Accepted", d.totalVolumeAccepted != null ? `${d.totalVolumeAccepted.toLocaleString()} ${(d.totalVolumeAcceptedUnit || "m³").replace("m3", "m³")}` : null)}
                          {fieldRow("Active Cell — Residual", d.activeCellResidualVolume != null ? `${d.activeCellResidualVolume.toLocaleString()} ${(d.activeCellResidualUnit || "m³").replace("m3", "m³")}` : null)}
                          {fieldRow("Active Cell — Inert", d.activeCellInertVolume != null ? `${d.activeCellInertVolume.toLocaleString()} ${(d.activeCellInertUnit || "m³").replace("m3", "m³")}` : null)}
                          {d.acceptsHazardousWaste && fieldRow("Active Cell — Hazardous", d.activeCellHazardousVolume != null ? `${d.activeCellHazardousVolume.toLocaleString()} ${(d.activeCellHazardousUnit || "m³").replace("m3", "m³")}` : null)}
                          {fieldRow("Closed Cell — Residual", d.closedCellResidualVolume != null ? `${d.closedCellResidualVolume.toLocaleString()} ${(d.closedCellResidualUnit || "m³").replace("m3", "m³")}` : null)}
                          {fieldRow("Closed Cell — Inert", d.closedCellInertVolume != null ? `${d.closedCellInertVolume.toLocaleString()} ${(d.closedCellInertUnit || "m³").replace("m3", "m³")}` : null)}
                          {d.acceptsHazardousWaste && fieldRow("Closed Cell — Hazardous", d.closedCellHazardousVolume != null ? `${d.closedCellHazardousVolume.toLocaleString()} ${(d.closedCellHazardousUnit || "m³").replace("m3", "m³")}` : null)}
                        </Row>
                      ),
                    },
                    {
                      key: "operations",
                      label: <Text strong style={{ fontSize: 13 }}><PieChartOutlined style={{ color: "#13c2c2", marginRight: 6 }} />Cell Capacity</Text>,
                      children: (() => {
                        const fac = d.slfGenerator || {};
                        const facilityCapacity = fac.volumeCapacity || 0;
                        const baselineVol = d.totalVolumeAccepted || 0;
                        const truckVol = (d.trucks || []).reduce((s, t) => s + (t.actualVolume || 0), 0);
                        const filledVol = baselineVol + truckVol;
                        const pct = facilityCapacity > 0 ? Math.min(Math.round((filledVol / facilityCapacity) * 100), 100) : 0;
                        return (
                          <div>
                            <Row gutter={16}>
                              {fieldRow("Current Cell Volume", d.currentCellVolume != null ? `${d.currentCellVolume.toLocaleString()} ${(d.currentCellVolumeUnit || "m³").replace("m3", "m³")}` : null)}
                              {fieldRow("Cell Status", <Tag color={d.cellStatus === "Closed" ? "red" : "green"} bordered={false}>{d.cellStatus || "Active"}</Tag>)}
                              {fieldRow("Number of Cells", fac.numberOfCell || "—")}
                              {fieldRow("Facility Capacity", facilityCapacity > 0 ? `${facilityCapacity.toLocaleString()} m³` : "—")}
                            </Row>
                            <Divider style={{ margin: "4px 0 16px" }} />
                            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                              <Progress
                                type="dashboard"
                                percent={pct}
                                size={110}
                                strokeColor={pct >= 90 ? "#ff4d4f" : pct >= 70 ? "#faad14" : "#52c41a"}
                                format={() => (
                                  <div style={{ textAlign: "center", lineHeight: 1.3 }}>
                                    <div style={{ fontSize: 18, fontWeight: 700, color: pct >= 90 ? "#ff4d4f" : pct >= 70 ? "#faad14" : "#52c41a" }}>{pct}%</div>
                                    <div style={{ fontSize: 10, color: "#8c8c8c" }}>filled</div>
                                  </div>
                                )}
                              />
                              <div style={{ flex: 1 }}>
                                <Text strong style={{ fontSize: 13, display: "block", marginBottom: 8 }}>Cell Capacity Usage</Text>
                                <Row gutter={8}>
                                  <Col xs={12}>
                                    <Text type="secondary" style={{ fontSize: 11 }}>Baseline Volume</Text>
                                    <div><Text style={{ fontSize: 13 }}>{baselineVol > 0 ? `${baselineVol.toLocaleString()} ${(d.totalVolumeAcceptedUnit || "m³").replace("m3", "m³")}` : "0"}</Text></div>
                                  </Col>
                                  <Col xs={12}>
                                    <Text type="secondary" style={{ fontSize: 11 }}>Transport & Disposal</Text>
                                    <div><Text style={{ fontSize: 13 }}>{truckVol > 0 ? `${truckVol.toLocaleString()} tons` : "0"}</Text></div>
                                  </Col>
                                  <Col xs={12}>
                                    <Text type="secondary" style={{ fontSize: 11, marginTop: 8, display: "block" }}>Total Filled</Text>
                                    <div><Text strong style={{ fontSize: 14, color: "#1a3353" }}>{filledVol > 0 ? filledVol.toLocaleString() : "0"}</Text></div>
                                  </Col>
                                  <Col xs={12}>
                                    <Text type="secondary" style={{ fontSize: 11, marginTop: 8, display: "block" }}>Remaining</Text>
                                    <div><Text strong style={{ fontSize: 14, color: facilityCapacity - filledVol <= 0 ? "#ff4d4f" : "#52c41a" }}>{facilityCapacity > 0 ? (facilityCapacity - filledVol).toLocaleString() : "No capacity set"}</Text></div>
                                  </Col>
                                </Row>
                              </div>
                            </div>
                          </div>
                        );
                      })(),
                    },
                    ...(d.accreditedHaulers?.length > 0 ? [{
                      key: "haulers",
                      label: <Text strong style={{ fontSize: 13 }}><TeamOutlined style={{ color: "#1a3353", marginRight: 6 }} />Accredited Haulers ({d.accreditedHaulers.length})</Text>,
                      children: (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {d.accreditedHaulers.map((h, i) => {
                            const clients = Array.isArray(h.privateSectorClients)
                              ? h.privateSectorClients
                              : h.privateSectorClients ? [h.privateSectorClients] : [];
                            const vehicles = h.vehicles?.length > 0
                              ? h.vehicles
                              : h.plateNumber || h.vehicleType || h.capacity != null
                                ? [{ plateNumber: h.plateNumber, vehicleType: h.vehicleType, capacity: h.capacity, capacityUnit: h.capacityUnit }]
                                : [];
                            return (
                              <div key={i} style={{ background: "#fff", borderRadius: 6, padding: "14px 16px", border: "1px solid #e8e8e8" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#1a3353", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>{i + 1}</div>
                                  <Text strong style={{ fontSize: 13 }}>{h.haulerName || "Unnamed Hauler"}</Text>
                                </div>
                                <Row gutter={16}>
                                  {fieldRow("No. of Trucks", h.numberOfTrucks ?? "—")}
                                  {fieldRow("Office Address", h.officeAddress || "—", { span: 2 })}
                                  {fieldRow("Private Sector/LGU Clients", clients.length > 0 ? clients.join(", ") : "—", { span: 2 })}
                                </Row>
                                {vehicles.length > 0 && (
                                  <Table
                                    dataSource={vehicles}
                                    rowKey={(_, vi) => vi}
                                    size="small"
                                    pagination={false}
                                    style={{ marginTop: 8 }}
                                    columns={[
                                      { title: "#", key: "idx", width: 40, render: (_, __, vi) => vi + 1 },
                                      { title: "Plate Number", dataIndex: "plateNumber", key: "plate", render: (v) => v || "—" },
                                      { title: "Vehicle Type", dataIndex: "vehicleType", key: "type", render: (v) => v || "—" },
                                      { title: "Capacity", key: "cap", render: (_, v) => v.capacity != null ? `${v.capacity} ${(v.capacityUnit || "m³").replace("m3", "m³")}` : "—" },
                                    ]}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ),
                    }] : []),
                    {
                      key: "transport",
                      label: <Text strong style={{ fontSize: 13 }}><CarOutlined style={{ color: "#1a3353", marginRight: 6 }} />Transport & Disposal ({(d.trucks || []).length} entries)</Text>,
                      children: (d.trucks || []).length > 0 ? (
                        <Table
                          dataSource={d.trucks}
                          rowKey={(_, i) => i}
                          size="small"
                          pagination={false}
                          columns={[
                            { title: "#", key: "idx", width: 40, render: (_, __, i) => <Text type="secondary">{i + 1}</Text> },
                            { title: "Ticket No.", dataIndex: "disposalTicketNo", key: "ticket", render: (v) => v || "—" },
                            { title: "Hauler", dataIndex: "hauler", key: "hauler", render: (v) => <Text strong>{v || "—"}</Text> },
                            { title: "Plate No.", dataIndex: "plateNumber", key: "plate", render: (v) => v || "—" },
                            { title: "Capacity", key: "cap", render: (_, t) => t.truckCapacity ? `${t.truckCapacity} ${(t.truckCapacityUnit || "m³").replace("m3", "m³")}` : "—" },
                            { title: "Volume", key: "vol", render: (_, t) => t.actualVolume != null ? <Text strong style={{ color: "#52c41a" }}>{t.actualVolume} {t.actualVolumeUnit || "tons"}</Text> : "—" },
                            { title: "Waste Type", dataIndex: "wasteType", key: "waste", render: (v) => v ? <Tag color={v === "Residual" ? "blue" : "volcano"} bordered={false}>{v}</Tag> : "—" },
                            { title: "HW Code", key: "hw", render: (_, t) => {
                              const codes = Array.isArray(t.hazWasteCode) ? t.hazWasteCode : t.hazWasteCode ? [t.hazWasteCode] : [];
                              return codes.length > 0 ? codes.join(", ") : "—";
                            }},
                          ]}
                        />
                      ) : (
                        <div style={{ textAlign: "center", padding: "20px 0" }}>
                          <Text type="secondary">No transport entries recorded.</Text>
                        </div>
                      ),
                    },
                  ]}
                />

                {/* Revert Info Banner */}
                {d.status === "reverted" && d.revertReason && (
                  <div style={{ background: "#fff2e8", border: "1px solid #ffbb96", borderRadius: 8, padding: "12px 16px", marginTop: 20 }}>
                    <Space align="start">
                      <UndoOutlined style={{ color: "#fa541c", marginTop: 2 }} />
                      <div>
                        <Text strong style={{ color: "#fa541c", fontSize: 13 }}>Reverted by Administrator</Text>
                        <div style={{ marginTop: 4 }}>
                          <Text style={{ fontSize: 12, color: "#8c8c8c" }}>Reason: {d.revertReason}</Text>
                        </div>
                        {d.revertedAt && (
                          <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(d.revertedAt).format("MMM D, YYYY h:mm A")}</Text>
                        )}
                      </div>
                    </Space>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ── Review Submission Modal ── */}
      <Modal
        title={
          <Space>
            <EyeOutlined style={{ color: "#1a3353" }} />
            <span>{editingRevertedId ? "Review Resubmission" : "Review Submission"}</span>
          </Space>
        }
        open={reviewModalOpen}
        onCancel={() => setReviewModalOpen(false)}
        onOk={editingRevertedId ? handleResubmitReverted : handleConfirmSubmit}
        okText={editingRevertedId ? "Confirm & Resubmit" : "Confirm & Submit"}
        okButtonProps={{
          className: "slf-primary-btn",
          loading,
          icon: <SendOutlined />,
        }}
        cancelText="Go Back"
        width={860}
        destroyOnHidden
      >
        <div
          style={{
            background: "#f6ffed",
            border: "1px solid #b7eb8f",
            borderRadius: 6,
            padding: "8px 14px",
            marginBottom: 16,
          }}
        >
          <CheckCircleOutlined
            style={{ color: "#52c41a", marginRight: 8 }}
          />
          <Text style={{ color: "#389e0d" }}>
            Please review all information below before confirming your
            submission.
          </Text>
        </div>
        {editingRevertedId && (
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
              <MessageOutlined style={{ marginRight: 6 }} />
              Comment / Message (optional)
            </Text>
            <Input.TextArea
              rows={3}
              maxLength={500}
              showCount
              placeholder="Add a comment about the changes you made or any message for the admin..."
              value={resubmitComment}
              onChange={(e) => setResubmitComment(e.target.value)}
              style={{ borderRadius: 6 }}
            />
          </div>
        )}
        <Collapse
          defaultActiveKey={[
            "company",
            "baseline",
            "disposal",
            "haulers",
            "transport",
          ]}
          bordered={false}
          expandIconPlacement="end"
          style={{ background: "transparent" }}
          items={[
            {
              key: "company",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <EnvironmentOutlined /> Company Information
                </Text>
              ),
              children: (
                <Descriptions
                  bordered
                  size="small"
                  column={{ xs: 1, sm: 2 }}
                >
                  <Descriptions.Item label="Company Name">
                    {companyForm.getFieldValue("lguCompanyName") || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Region">
                    {regions.find(
                      (r) =>
                        r.code ===
                        companyForm.getFieldValue("companyRegion"),
                    )?.name || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Province">
                    {provinces.find(
                      (p) =>
                        p.code ===
                        companyForm.getFieldValue("companyProvince"),
                    )?.name || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="City/Municipality">
                    {municipalities.find(
                      (m) =>
                        m.code ===
                        companyForm.getFieldValue("companyMunicipality"),
                    )?.name || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Barangay">
                    {barangays.find(
                      (b) =>
                        b.code ===
                        companyForm.getFieldValue("companyBarangay"),
                    )?.name || "—"}
                  </Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: "disposal",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <FileTextOutlined /> Waste Generator&apos;s Information
                </Text>
              ),
              children: (
                <Descriptions
                  bordered
                  size="small"
                  column={{ xs: 1, sm: 2 }}
                >
                  <Descriptions.Item label="Date of Disposal">
                    {entryForm.getFieldValue("dateOfDisposal")
                      ? dayjs(
                          entryForm.getFieldValue("dateOfDisposal"),
                        ).format("MM/DD/YYYY")
                      : "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="LGU/Company Name">
                    {trucks[0]?.lguCompanyName || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Company Type">
                    {trucks[0]?.companyType || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Address">
                    {trucks[0]?.address || "—"}
                  </Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: "baseline",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <DatabaseOutlined /> Baseline Data
                  {!baselineSaved && <Tag color="volcano" style={{ marginLeft: 8, fontSize: 10 }}>First-time Entry</Tag>}
                </Text>
              ),
              children: (
                <>
                  {!baselineSaved && (
                    <div style={{ background: "#fff7e6", border: "1px solid #ffe58f", borderRadius: 6, padding: "8px 14px", marginBottom: 12 }}>
                      <InfoCircleOutlined style={{ color: "#fa8c16", marginRight: 8 }} />
                      <Text style={{ color: "#ad6800", fontSize: 12 }}>
                        This baseline data will be <Text strong style={{ color: "#ad6800" }}>locked after submission</Text> and cannot be changed without requesting an update. Please verify all details carefully.
                      </Text>
                    </div>
                  )}
                  <Descriptions
                    bordered
                    size="small"
                    column={{ xs: 1, sm: 2 }}
                  >
                    <Descriptions.Item label="Total Volume Accepted">
                      {baselineForm.getFieldValue("totalVolumeAccepted") !=
                      null
                        ? `${Number(baselineForm.getFieldValue("totalVolumeAccepted")).toLocaleString()} ${(baselineForm.getFieldValue("totalVolumeAcceptedUnit") || "m³").replace("m3", "m³")}`
                        : "—"}
                    </Descriptions.Item>
                    <Descriptions.Item label="Active Cell Entries" span={2}>
                      {activeCellEntries.length === 0 ? "—" : (
                        <Table
                          dataSource={activeCellEntries}
                          rowKey="key"
                          size="small"
                          pagination={false}
                          style={{ marginTop: 4 }}
                          columns={[
                            { title: "Cell Name", dataIndex: "cellName", key: "cellName", render: v => v || "—" },
                            { title: "Waste Type", dataIndex: "wasteType", key: "wasteType" },
                            { title: "Volume", key: "vol", render: (_, r) => r.volume != null ? `${r.volume} ${baselineUnit || "m³"}` : "—" },
                          ]}
                        />
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="Closed Cell Entries" span={2}>
                      {closedCellEntries.length === 0 ? "—" : (
                        <Table
                          dataSource={closedCellEntries}
                          rowKey="key"
                          size="small"
                          pagination={false}
                          style={{ marginTop: 4 }}
                          columns={[
                            { title: "Cell Name", dataIndex: "cellName", key: "cellName", render: v => v || "—" },
                            { title: "Waste Type", dataIndex: "wasteType", key: "wasteType" },
                            { title: "Volume", key: "vol", render: (_, r) => r.volume != null ? `${r.volume} ${baselineUnit || "m³"}` : "—" },
                          ]}
                        />
                      )}
                    </Descriptions.Item>
                  </Descriptions>
                </>
              ),
            },
            ...(haulers.length > 0
              ? [
                  {
                    key: "haulers",
                    label: (
                      <Text strong style={{ color: "#1a3353" }}>
                        <TeamOutlined /> Accredited Haulers ({haulers.length}
                        )
                      </Text>
                    ),
                    children: (
                      <Table
                        dataSource={haulers}
                        rowKey="key"
                        size="small"
                        pagination={false}
                        scroll={{ x: 500 }}
                        columns={[
                          {
                            title: "Hauler",
                            dataIndex: "haulerName",
                          },
                          {
                            title: "Trucks",
                            dataIndex: "numberOfTrucks",
                            width: 70,
                          },
                          {
                            title: "Vehicles",
                            key: "vehicles",
                            render: (_, rec) => {
                              const vehs = rec.vehicles || [];
                              if (!vehs.length) return "—";
                              return vehs.map((v, i) => (
                                <div key={i} style={{ whiteSpace: "nowrap" }}>
                                  {v.plateNumber || "N/A"} — {v.vehicleType || "N/A"} ({v.capacity ?? "—"} {v.capacityUnit || "m³"})
                                </div>
                              ));
                            },
                          },
                          {
                            title: "Clients",
                            dataIndex: "privateSectorClients",
                            render: (v) => {
                              const arr = Array.isArray(v)
                                ? v
                                : v
                                  ? [v]
                                  : [];
                              return arr.length > 0
                                ? arr.join(", ")
                                : "—";
                            },
                          },
                        ]}
                      />
                    ),
                  },
                ]
              : []),
            {
              key: "transport",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <CarOutlined /> Transport Entries ({trucks.length})
                </Text>
              ),
              children: (
                <Table
                  dataSource={trucks}
                  rowKey="key"
                  size="small"
                  pagination={false}
                  scroll={{ x: 700 }}
                  columns={[
                    {
                      title: "#",
                      key: "i",
                      width: 40,
                      render: (_, __, i) => i + 1,
                    },
                    {
                      title: "Ticket No.",
                      dataIndex: "disposalTicketNo",
                      render: (v) => v || "—",
                    },
                    { title: "Hauler", dataIndex: "hauler" },
                    {
                      title: "Plate No.",
                      key: "plateNumber",
                      render: (_, t) => {
                        const vehs = t.vehicles || [];
                        if (vehs.length > 1) return vehs.map(v => v.plateNumber).filter(Boolean).join(", ") || t.plateNumber || "—";
                        return vehs[0]?.plateNumber || t.plateNumber || "—";
                      },
                    },
                    {
                      title: "Capacity",
                      key: "cap",
                      render: (_, t) => {
                        const vehs = t.vehicles || [];
                        if (vehs.length > 1) return vehs.filter(v => v.capacity != null).map(v => `${v.capacity} ${(v.capacityUnit || "m³").replace("m3", "m³")}`).join(", ") || "—";
                        const cap = vehs[0]?.capacity ?? t.truckCapacity;
                        const unit = vehs[0]?.capacityUnit || t.truckCapacityUnit || "m³";
                        return cap != null ? `${cap} ${unit.replace("m3", "m³")}` : "—";
                      },
                    },
                    {
                      title: "Volume",
                      key: "vol",
                      render: (_, t) =>
                        t.actualVolume != null
                          ? `${t.actualVolume} ${t.actualVolumeUnit || "tons"}`
                          : "—",
                    },
                    {
                      title: "Waste Type",
                      dataIndex: "wasteType",
                      render: (v) => v || "—",
                    },
                    {
                      title: "Haz. Code",
                      dataIndex: "hazWasteCode",
                      render: (v) => v || "—",
                    },
                    {
                      title: "Clients",
                      key: "clients",
                      render: (_, t) => {
                        const vehs = t.vehicles || [];
                        const allClients = vehs.flatMap(v => v.selectedClients || []);
                        if (!allClients.length) return "—";
                        return allClients.map((c, i) => (
                          <Tag key={i} color={c.clientType === "LGU" ? "blue" : "green"} style={{ marginBottom: 2, fontSize: 11 }}>
                            {typeof c === "object" ? c.clientName : c}
                          </Tag>
                        ));
                      },
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      </Modal>

      {/* ── Revert Request Modal ── */}
      <Modal
        title={
          <Space>
            <UndoOutlined style={{ color: "#fa8c16" }} />
            <span>Request Edit — {revertRecord?.idNo}</span>
          </Space>
        }
        open={revertModalOpen}
        onCancel={() => {
          setRevertModalOpen(false);
          setRevertRecord(null);
          setRevertReason("");
        }}
        onOk={handleRequestRevert}
        okText="Submit Request"
        okButtonProps={{
          className: "slf-primary-btn",
          loading: revertLoading,
          disabled: !revertReason.trim(),
        }}
        destroyOnHidden
        width={500}
      >
        <Text style={{ display: "block", marginBottom: 12 }}>
          Please state the reason for requesting changes on this approved
          submission. You may also send an email to{" "}
          <Text strong>emb_region3@emb.gov.ph</Text> for follow-up.
        </Text>
        <TextArea
          rows={4}
          placeholder="Describe the changes you need to make..."
          value={revertReason}
          onChange={(e) => setRevertReason(e.target.value)}
          maxLength={500}
          showCount
        />
        <div style={{ marginTop: 12 }}>
          <Button
            type="link"
            icon={<MailOutlined />}
            href="mailto:emb_region3@emb.gov.ph"
            target="_blank"
            style={{ padding: 0 }}
          >
            Email emb_region3@emb.gov.ph
          </Button>
        </div>
      </Modal>

      {/* ── Profile Modal ── */}
      <Modal
        title={
          <Space>
            <UserOutlined style={{ color: "#1a3353" }} />
            <span>My Profile</span>
          </Space>
        }
        open={profileModalOpen}
        onCancel={() => setProfileModalOpen(false)}
        footer={<Button onClick={() => setProfileModalOpen(false)}>Close</Button>}
        width={480}
        destroyOnHidden
      >
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <Avatar
            size={72}
            style={{ background: "linear-gradient(135deg, #1a3353, #2d5f8a)", fontSize: 28, marginBottom: 10 }}
          >
            {portalUser?.firstName?.[0]?.toUpperCase()}
          </Avatar>
          <div>
            <Text strong style={{ fontSize: 18 }}>
              {portalUser?.firstName} {portalUser?.lastName}
            </Text>
          </div>
        </div>
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="Email">{portalUser?.email || "—"}</Descriptions.Item>
          {portalUser?.officeEmail && (
            <Descriptions.Item label="Office Email">{portalUser.officeEmail}</Descriptions.Item>
          )}
          {portalUser?.pcoEmail && (
            <Descriptions.Item label="PCO Email">{portalUser.pcoEmail}</Descriptions.Item>
          )}
          <Descriptions.Item label="Contact No.">{portalUser?.contactNumber || "—"}</Descriptions.Item>
          {portalUser?.companyName && (
            <Descriptions.Item label="Company">{portalUser.companyName}</Descriptions.Item>
          )}
          <Descriptions.Item label="Assigned SLF">
            {Array.isArray(portalUser?.assignedSlfName) && portalUser.assignedSlfName.length > 0
              ? portalUser.assignedSlfName.map((name, i) => (
                  <Tag key={i} color="blue" style={{ marginBottom: 2 }}>{name}</Tag>
                ))
              : portalUser?.assignedSlfName
              ? <Tag color="blue">{portalUser.assignedSlfName}</Tag>
              : "—"}
          </Descriptions.Item>
          <Descriptions.Item label="Account Status">
            <Tag color={portalUser?.status === "approved" ? "green" : portalUser?.status === "pending" ? "orange" : "red"}>
              {portalUser?.status?.charAt(0).toUpperCase() + portalUser?.status?.slice(1) || "—"}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Email Verified">
            {portalUser?.isVerified ? <Tag color="green">Verified</Tag> : <Tag color="red">Not Verified</Tag>}
          </Descriptions.Item>
        </Descriptions>
      </Modal>

      {/* ── Support & FAQ Floating Button ── */}
      <Button
        type="primary"
        icon={<QuestionCircleOutlined />}
        onClick={() => {
          setSupportDrawerOpen(true);
          if (supportTickets.length === 0) fetchSupportTickets();
        }}
        style={{
          position: "fixed",
          bottom: 32,
          right: 32,
          zIndex: 999,
          height: 48,
          borderRadius: 24,
          fontSize: 15,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "#1a3353",
          borderColor: "#1a3353",
          boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
          paddingInline: 20,
        }}
      >
        Support &amp; FAQ
      </Button>

      {/* ── Support Drawer ── */}
      <Drawer
        title="Support & FAQ"
        placement="right"
        size={isMobile ? "100%" : 520}
        onClose={() => setSupportDrawerOpen(false)}
        open={supportDrawerOpen}
        styles={{ body: { padding: 0 } }}
      >
        <Tabs
          activeKey={supportTab}
          onChange={setSupportTab}
          style={{ padding: "0 16px" }}
          items={[
            {
              key: "faq",
              label: (
                <span>
                  <QuestionCircleOutlined /> FAQ
                </span>
              ),
              children: (
                <Collapse
                  activeKey={faqActiveKey}
                  onChange={setFaqActiveKey}
                  bordered={false}
                  items={[
                    { key: "1", label: "How do I submit disposal data?", children: <Text>Navigate to Data Entry, fill in all required tabs (Basic Info, Baseline, Waste Generator Info), add at least one transport entry, then click Submit.</Text> },
                    { key: "2", label: "How do I update baseline data?", children: <Text>Baseline data is locked after your first submission. Click &ldquo;Request Update&rdquo; in the Baseline tab. An admin will review and approve your request.</Text> },
                    { key: "3", label: "How do I edit a submitted entry?", children: <Text>Go to History, find the entry, and click &ldquo;Request Edit&rdquo;. The admin will review and either approve or reject your request.</Text> },
                    { key: "4", label: "What file formats are supported for upload?", children: <Text>You can upload Excel (.xlsx, .xls) or CSV files for bulk hauler and waste generator entries.</Text> },
                    { key: "5", label: "Who do I contact for technical issues?", children: <Text>Submit a support ticket using the &ldquo;New Ticket&rdquo; tab, or email emb_region3@emb.gov.ph directly.</Text> },
                  ]}
                />
              ),
            },
            {
              key: "new-ticket",
              label: (
                <span>
                  <SendOutlined /> New Ticket
                </span>
              ),
              children: (
                <Form
                  layout="vertical"
                  onFinish={handleSubmitTicket}
                  style={{ padding: "8px 0" }}
                >
                  <Form.Item
                    name="category"
                    label="Category"
                    rules={[{ required: true, message: "Select a category" }]}
                  >
                    <Select placeholder="Select category">
                      <Option value="Technical Issue">Technical Issue</Option>
                      <Option value="Data Correction">Data Correction</Option>
                      <Option value="Account Issue">Account Issue</Option>
                      <Option value="Feature Request">Feature Request</Option>
                      <Option value="Other">Other</Option>
                    </Select>
                  </Form.Item>
                  <Form.Item
                    name="subject"
                    label="Subject"
                    rules={[{ required: true, message: "Enter a subject" }]}
                  >
                    <Input placeholder="Brief description of your concern" />
                  </Form.Item>
                  <Form.Item
                    name="message"
                    label="Message"
                    rules={[{ required: true, message: "Describe your concern" }]}
                  >
                    <Input.TextArea rows={4} placeholder="Detailed description..." />
                  </Form.Item>
                  <Form.Item>
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={supportSubmitting}
                      className="slf-primary-btn"
                      block
                    >
                      Submit Ticket
                    </Button>
                  </Form.Item>
                </Form>
              ),
            },
            {
              key: "my-tickets",
              label: (
                <span>
                  <FileTextOutlined /> My Tickets
                </span>
              ),
              children: (
                <div style={{ padding: "8px 0" }}>
                  {supportLoading ? (
                    <div style={{ textAlign: "center", padding: 40 }}><Spin /></div>
                  ) : supportTickets.length === 0 ? (
                    <Empty description="No support tickets yet" />
                  ) : (
                    <List
                      dataSource={supportTickets}
                      renderItem={(ticket) => (
                        <List.Item
                          style={{ cursor: "pointer", padding: "12px 0" }}
                          onClick={() => setSupportDetailModal(ticket)}
                        >
                          <List.Item.Meta
                            title={
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <Text strong style={{ fontSize: 13 }}>{ticket.subject}</Text>
                                <Tag color={
                                  ticket.status === "open" ? "blue" :
                                  ticket.status === "in_progress" ? "orange" :
                                  ticket.status === "resolved" ? "green" : "default"
                                }>
                                  {ticket.status?.replace("_", " ").toUpperCase()}
                                </Tag>
                              </div>
                            }
                            description={
                              <div>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                  {ticket.ticketNo} &middot; {ticket.category} &middot; {dayjs(ticket.createdAt).format("MMM D, YYYY h:mm A")}
                                </Text>
                              </div>
                            }
                          />
                        </List.Item>
                      )}
                    />
                  )}
                </div>
              ),
            },
          ]}
        />
      </Drawer>

      {/* ── Support Ticket Detail Modal ── */}
      <Modal
        title={supportDetailModal ? `${supportDetailModal.ticketNo} — ${supportDetailModal.subject}` : "Ticket Detail"}
        open={!!supportDetailModal}
        onCancel={() => {
          setSupportDetailModal(null);
          setSupportReplyText("");
        }}
        footer={null}
        width={600}
      >
        {supportDetailModal && (
          <>
            <Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Status">
                <Tag color={
                  supportDetailModal.status === "open" ? "blue" :
                  supportDetailModal.status === "in_progress" ? "orange" :
                  supportDetailModal.status === "resolved" ? "green" : "default"
                }>
                  {supportDetailModal.status?.replace("_", " ").toUpperCase()}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Category">{supportDetailModal.category}</Descriptions.Item>
              <Descriptions.Item label="Priority">
                <Tag color={
                  supportDetailModal.priority === "Urgent" ? "red" :
                  supportDetailModal.priority === "High" ? "orange" :
                  supportDetailModal.priority === "Medium" ? "gold" : "default"
                }>
                  {supportDetailModal.priority}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Date">{dayjs(supportDetailModal.createdAt).format("MMM D, YYYY h:mm A")}</Descriptions.Item>
            </Descriptions>
            <div style={{ background: "#f5f5f5", padding: "12px 16px", borderRadius: 6, marginBottom: 16 }}>
              <Text>{supportDetailModal.message}</Text>
            </div>
            {supportDetailModal.replies?.length > 0 && (
              <>
                <Divider style={{ margin: "12px 0" }}>Replies</Divider>
                {supportDetailModal.replies.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      background: r.isAdmin ? "#e6f4ff" : "#f6ffed",
                      padding: "10px 14px",
                      borderRadius: 6,
                      marginBottom: 8,
                      borderLeft: `3px solid ${r.isAdmin ? "#1677ff" : "#52c41a"}`,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <Text strong style={{ fontSize: 12 }}>{r.isAdmin ? "Admin" : "You"}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(r.createdAt).format("MMM D, h:mm A")}</Text>
                    </div>
                    <Text style={{ fontSize: 13 }}>{r.message}</Text>
                  </div>
                ))}
              </>
            )}
            {supportDetailModal.status !== "closed" && supportDetailModal.status !== "resolved" && (
              <div style={{ marginTop: 12 }}>
                <Input.TextArea
                  rows={3}
                  placeholder="Type your reply..."
                  value={supportReplyText}
                  onChange={(e) => setSupportReplyText(e.target.value)}
                />
                <Button
                  type="primary"
                  className="slf-primary-btn"
                  style={{ marginTop: 8 }}
                  loading={supportSubmitting}
                  disabled={!supportReplyText.trim()}
                  onClick={() => handleSupportReply(supportDetailModal._id)}
                >
                  Send Reply
                </Button>
              </div>
            )}
          </>
        )}
      </Modal>

      {/* ── Upload Format Guide Modal ── */}
      <Modal
        title={<Space><InfoCircleOutlined style={{ color: "#1677ff" }} /><Text strong>{uploadGuideType === "hauler" ? "Hauler Upload — Format Guide" : "Disposal Entry Upload — Format Guide"}</Text></Space>}
        open={uploadGuideOpen}
        onCancel={() => setUploadGuideOpen(false)}
        onOk={proceedToFilePicker}
        okText={<Space><UploadOutlined /> Proceed to Upload</Space>}
        okButtonProps={{ className: "slf-primary-btn" }}
        cancelText="Cancel"
        width={600}
        destroyOnHidden
      >
        {uploadGuideType === "hauler" ? (
          <div>
            <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
              Your Excel or CSV file must contain the following columns (in any order):
            </Text>
            <Table
              size="small"
              pagination={false}
              dataSource={[
                { col: "Hauler Name", desc: "Full name of the accredited hauler", required: true },
                { col: "Number of Trucks", desc: "Total number of registered trucks", required: true },
                { col: "Office Address", desc: "Office address of the hauler", required: false },
                { col: "Plate Number", desc: "Plate number of the vehicle", required: false },
                { col: "Vehicle Type", desc: "e.g. Dump Truck, Compactor", required: false },
                { col: "Capacity", desc: "Vehicle capacity in m³ or tons", required: false },
              ]}
              columns={[
                { title: "Column Header", dataIndex: "col", width: 180, render: v => <Text code>{v}</Text> },
                { title: "Description", dataIndex: "desc" },
                { title: "Required", dataIndex: "required", width: 80, align: "center", render: v => v ? <Tag color="red">Yes</Tag> : <Tag>No</Tag> },
              ]}
              rowKey="col"
            />
            <div style={{ marginTop: 12, padding: "8px 12px", background: "#fffbe6", borderRadius: 6, border: "1px solid #ffe58f" }}>
              <Text style={{ fontSize: 12 }}><InfoCircleOutlined style={{ color: "#faad14", marginRight: 6 }} />
                Each row represents one vehicle entry under a hauler. Rows sharing the same Hauler Name will be grouped.
              </Text>
            </div>
          </div>
        ) : (
          <div>
            <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
              Your Excel or CSV file must contain the following columns (in any order):
            </Text>
            <Table
              size="small"
              pagination={false}
              dataSource={[
                { col: "Disposal Ticket No", desc: "Unique ticket/reference number", required: true },
                { col: "Hauler Name", desc: "Name of the hauler who transported the waste", required: true },
                { col: "Plate Number", desc: "Plate number of the truck", required: true },
                { col: "Truck Capacity", desc: "Truck capacity in m³ or tons", required: false },
                { col: "Actual Volume", desc: "Actual volume of waste transported", required: true },
                { col: "Waste Type", desc: "e.g. Residual, Hazardous, Mixed", required: true },
              ]}
              columns={[
                { title: "Column Header", dataIndex: "col", width: 180, render: v => <Text code>{v}</Text> },
                { title: "Description", dataIndex: "desc" },
                { title: "Required", dataIndex: "required", width: 80, align: "center", render: v => v ? <Tag color="red">Yes</Tag> : <Tag>No</Tag> },
              ]}
              rowKey="col"
            />
            <div style={{ marginTop: 12, padding: "8px 12px", background: "#fffbe6", borderRadius: 6, border: "1px solid #ffe58f" }}>
              <Text style={{ fontSize: 12 }}><InfoCircleOutlined style={{ color: "#faad14", marginRight: 6 }} />
                Each row in the file represents one disposal trip. Volume unit defaults to <Text code>m³</Text> unless specified.
              </Text>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Upload Preview Modal ── */}
      <Modal
        title="Preview Uploaded Data"
        open={uploadModalOpen}
        onCancel={() => {
          setUploadModalOpen(false);
          setUploadPreviewData([]);
          setUploadPreviewColumns([]);
          setUploadType(null);
        }}
        onOk={handleConfirmUpload}
        okText={`Import ${uploadPreviewData.length} ${uploadType === "hauler" ? "Hauler(s)" : "Entry/Entries"}`}
        okButtonProps={{ className: "slf-primary-btn" }}
        width={900}
      >
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Review the data below. Click on any cell to edit before importing.
          </Text>
        </div>
        <Table
          dataSource={uploadPreviewData}
          columns={(uploadPreviewColumns || []).map((col) => {
            // keep the row-number (#) and actions columns as-is
            if (!col.dataIndex || col.key === "actions" || col.title === "#") return col;
            return {
              ...col,
              render: (text, record) => (
                <Input
                  size="small"
                  value={text ?? ""}
                  onChange={(e) => updateUploadCell(record.key, col.dataIndex, e.target.value)}
                  style={{ border: "none", background: "transparent", padding: "2px 4px" }}
                />
              ),
            };
          })}
          rowKey={(_, i) => i}
          size="small"
          pagination={false}
          scroll={{ x: 700 }}
        />
      </Modal>

      {/* ── Active Cell Entry Modal ── */}
      <Modal
        title={editingActiveCellKey != null ? "Edit Cell Entry" : "Add Cell Entry"}
        open={activeCellModalOpen}
        onCancel={() => setActiveCellModalOpen(false)}
        onOk={handleSaveActiveCellEntry}
        okText={editingActiveCellKey != null ? "Update" : "Add"}
        okButtonProps={{ className: "slf-primary-btn" }}
        destroyOnHidden
        width={420}
      >
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="Cell Name" required>
            <Input
              placeholder="e.g. Cell 1"
              value={activeCellDraft.cellName}
              onChange={e => setActiveCellDraft(d => ({ ...d, cellName: e.target.value }))}
            />
          </Form.Item>
          <Form.Item label="Waste Type" required>
            <Select
              value={activeCellDraft.wasteType}
              onChange={v => setActiveCellDraft(d => ({ ...d, wasteType: v }))}
              options={[
                { label: "Residual", value: "Residual" },
                { label: "Inert/Hazardous Waste", value: "Inert/Hazardous Waste" },
              ]}
            />
          </Form.Item>
          <Form.Item label="Volume" required>
            <Space.Compact style={{ width: "100%" }}>
              <InputNumber
                placeholder="Volume"
                style={{ width: "100%" }}
                min={0}
                step={0.01}
                value={activeCellDraft.volume}
                onChange={v => setActiveCellDraft(d => ({ ...d, volume: v }))}
              />
              <span className="ant-input-group-addon">{baselineUnit === "m³" ? <>m<sup>3</sup></> : "tons"}</span>
            </Space.Compact>
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Closed Cell Entry Modal ── */}
      <Modal
        title={editingClosedCellKey != null ? "Edit Closed Cell Entry" : "Add Closed Cell Entry"}
        open={closedCellModalOpen}
        onCancel={() => setClosedCellModalOpen(false)}
        onOk={handleSaveClosedCellEntry}
        okText={editingClosedCellKey != null ? "Update" : "Add"}
        okButtonProps={{ className: "slf-primary-btn" }}
        destroyOnHidden
        width={420}
      >
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="Cell Name" required>
            <Input
              placeholder="e.g. Cell 3"
              value={closedCellDraft.cellName}
              onChange={e => setClosedCellDraft(d => ({ ...d, cellName: e.target.value }))}
            />
          </Form.Item>
          <Form.Item label="Waste Type" required>
            <Select
              value={closedCellDraft.wasteType}
              onChange={v => setClosedCellDraft(d => ({ ...d, wasteType: v }))}
              options={[
                { label: "Residual", value: "Residual" },
                { label: "Inert/Hazardous Waste", value: "Inert/Hazardous Waste" },
              ]}
            />
          </Form.Item>
          <Form.Item label="Volume" required>
            <Space.Compact style={{ width: "100%" }}>
              <InputNumber
                placeholder="Volume"
                style={{ width: "100%" }}
                min={0}
                step={0.01}
                value={closedCellDraft.volume}
                onChange={v => setClosedCellDraft(d => ({ ...d, volume: v }))}
              />
              <span className="ant-input-group-addon">{baselineUnit === "m³" ? <>m<sup>3</sup></> : "tons"}</span>
            </Space.Compact>
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Hauler Client Modal ── */}
      <Modal
        title={editingClientKey != null ? "Edit Client" : "Add Client"}
        open={clientModalOpen}
        onCancel={() => setClientModalOpen(false)}
        onOk={handleSaveClient}
        okText={editingClientKey != null ? "Update" : "Add"}
        okButtonProps={{ className: "slf-primary-btn" }}
        destroyOnHidden
        width={480}
      >
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="Client Name" required>
            <Input
              placeholder="Name of LGU / company"
              value={clientDraft.clientName}
              onChange={e => setClientDraft(d => ({ ...d, clientName: e.target.value }))}
            />
          </Form.Item>
          <Form.Item label="Client Type" required>
            <Select
              value={clientDraft.clientType}
              onChange={v => setClientDraft(d => ({ ...d, clientType: v, region: "", province: "", municipality: "" }))}
              options={[
                { label: "Private", value: "Private" },
                { label: "LGU", value: "LGU" },
              ]}
            />
          </Form.Item>
          {clientDraft.clientType === "LGU" && (
            <>
              <Form.Item label="Region">
                <Select
                  placeholder="Select region"
                  value={clientDraft.region || undefined}
                  loading={loadingClientAddress === "region"}
                  showSearch
                  optionFilterProp="label"
                  options={(regions || []).map(r => ({ label: r.name, value: String(r.code) }))}
                  onChange={async v => {
                    setClientDraft(d => ({ ...d, region: v, province: "", municipality: "" }));
                    setClientProvinces([]);
                    setClientMunicipalities([]);
                    setLoadingClientAddress("province");
                    try {
                      const res = await fetch(`https://psgc.gitlab.io/api/regions/${v}/provinces/`);
                      setClientProvinces(await res.json());
                    } catch (_) {}
                    setLoadingClientAddress("");
                  }}
                />
              </Form.Item>
              <Form.Item label="Province">
                <Select
                  placeholder="Select province"
                  value={clientDraft.province || undefined}
                  loading={loadingClientAddress === "province"}
                  showSearch
                  optionFilterProp="label"
                  options={(clientProvinces || []).map(p => ({ label: p.name, value: String(p.code) }))}
                  onChange={async v => {
                    setClientDraft(d => ({ ...d, province: v, municipality: "" }));
                    setClientMunicipalities([]);
                    setLoadingClientAddress("municipality");
                    try {
                      const res = await fetch(`https://psgc.gitlab.io/api/provinces/${v}/cities-municipalities/`);
                      setClientMunicipalities(await res.json());
                    } catch (_) {}
                    setLoadingClientAddress("");
                  }}
                />
              </Form.Item>
              <Form.Item label="Municipality/City">
                <Select
                  placeholder="Select municipality"
                  value={clientDraft.municipality || undefined}
                  loading={loadingClientAddress === "municipality"}
                  showSearch
                  optionFilterProp="label"
                  options={(clientMunicipalities || []).map(m => ({ label: m.name, value: String(m.code) }))}
                  onChange={v => setClientDraft(d => ({ ...d, municipality: v }))}
                />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

      {/* ── Hauler Deletion Request Modal ── */}
      <Modal
        title={
          <Space>
            <DeleteOutlined style={{ color: "#ff4d4f" }} />
            <span>Request Hauler Deletion</span>
          </Space>
        }
        open={haulerDeleteModal.open}
        onCancel={() => { setHaulerDeleteModal({ open: false, hauler: null }); setHaulerDeleteReason(""); setHaulerDeleteFile(null); }}
        onOk={async () => {
          if (!haulerDeleteReason.trim()) {
            return;
          }
          setHaulerDeleteLoading(true);
          try {
            const h = haulerDeleteModal.hauler;
            const fd = new FormData();
            fd.append("portalUserEmail", portalUser?.email || "");
            fd.append("portalUserName", portalUser ? `${portalUser.firstName || ""} ${portalUser.lastName || ""}`.trim() : "");
            fd.append("companyName", portalUser?.companyName || "");
            fd.append("slfName", activeSlfName || "");
            fd.append("haulerKey", String(h?.key || ""));
            fd.append("haulerName", h?.haulerName || "");
            fd.append("officeAddress", h?.officeAddress || "");
            fd.append("reason", haulerDeleteReason.trim());
            if (haulerDeleteFile) fd.append("letterOfIntent", haulerDeleteFile);
            await api.post("/hauler-delete-requests", fd, {
              headers: { "Content-Type": "multipart/form-data" },
            });
            setHaulerDeleteModal({ open: false, hauler: null });
            setHaulerDeleteReason("");
            setHaulerDeleteFile(null);
            Modal.success({
              title: "Request Submitted",
              content: "Your hauler deletion request has been submitted. EMB Region 3 will review it and you will be notified of the decision.",
            });
          } catch (err) {
            Modal.error({
              title: "Submission Failed",
              content: err?.response?.data?.message || "Could not submit the request. Please try again.",
            });
          } finally {
            setHaulerDeleteLoading(false);
          }
        }}
        okText="Submit Request"
        okButtonProps={{ danger: true, loading: haulerDeleteLoading, disabled: !haulerDeleteReason.trim() }}
        cancelText="Cancel"
        destroyOnHidden
        width={520}
      >
        <div style={{ background: "#fff2f0", border: "1px solid #ffccc7", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
          <Text style={{ fontSize: 12, color: "#cf1322" }}>
            <strong>Note:</strong> Hauler deletion requires EMB Region 3 approval. Please provide a valid justification and attach a Letter of Intent.
          </Text>
        </div>
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="Hauler to be Deleted">
            <Input value={haulerDeleteModal.hauler?.haulerName || ""} disabled />
          </Form.Item>
          <Form.Item label="Reason / Justification" required validateStatus={haulerDeleteReason.trim() ? "" : "error"} help={!haulerDeleteReason.trim() ? "Please provide a reason." : ""}>
            <Input.TextArea
              rows={4}
              placeholder="Explain the reason for requesting this hauler to be deleted..."
              value={haulerDeleteReason}
              onChange={e => setHaulerDeleteReason(e.target.value)}
              maxLength={1000}
              showCount
            />
          </Form.Item>
          <Form.Item label="Letter of Intent (PDF, DOC, DOCX, JPG, PNG)" extra="Maximum 20 MB">
            <input
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              style={{ display: "none" }}
              id="hauler-loi-file-input"
              onChange={e => setHaulerDeleteFile(e.target.files[0] || null)}
            />
            <Space>
              <Button icon={<UploadOutlined />} onClick={() => document.getElementById("hauler-loi-file-input").click()}>
                {haulerDeleteFile ? "Change File" : "Attach File"}
              </Button>
              {haulerDeleteFile && (
                <Space size={4}>
                  <Text style={{ fontSize: 12 }}>{haulerDeleteFile.name}</Text>
                  <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => { setHaulerDeleteFile(null); document.getElementById("hauler-loi-file-input").value = ""; }} />
                </Space>
              )}
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* ══════════════════════ WASTE RECEIVED MODAL ══════════════════════ */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #fa8c16, #d46b08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <BarChartOutlined style={{ color: "#fff", fontSize: 16 }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1a3353" }}>Waste Received Breakdown</div>
              <div style={{ fontSize: 11, color: "#8c8c8c", fontWeight: 400 }}>{activeSlfName}</div>
            </div>
          </div>
        }
        open={wasteReceivedModalOpen}
        onCancel={() => setWasteReceivedModalOpen(false)}
        footer={<Button onClick={() => setWasteReceivedModalOpen(false)}>Close</Button>}
        width={800}
        destroyOnHidden
      >
        <Spin spinning={wasteReceivedLoading}>
          {[
            { key: "lguR3", label: "LGU Waste — Region III (Central Luzon)", color: "#1890ff", bg: "#e6f7ff", icon: <TeamOutlined /> },
            { key: "lguOutside", label: "LGU Waste — Outside Region III", color: "#722ed1", bg: "#f9f0ff", icon: <TeamOutlined /> },
            { key: "privateIndustry", label: "Waste from Private Industries", color: "#52c41a", bg: "#f6ffed", icon: <BankOutlined /> },
          ].map(({ key, label, color, bg, icon }) => {
            const rows = wasteReceivedData[key] || [];
            const total = rows.reduce((s, r) => s + (r.totalVolume || 0), 0);
            return (
              <div key={key} style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "8px 12px", background: bg, borderRadius: 8, border: `1px solid ${color}30` }}>
                  <span style={{ color, fontSize: 14 }}>{icon}</span>
                  <Text strong style={{ color, fontSize: 13 }}>{label}</Text>
                  <Tag color={color === "#1890ff" ? "blue" : color === "#722ed1" ? "purple" : "green"} style={{ marginLeft: "auto" }}>
                    {rows.length} company{rows.length !== 1 ? "ies" : "y"}
                  </Tag>
                  <Text style={{ fontSize: 12, color: "#8c8c8c" }}>Total: {total.toLocaleString()} m³</Text>
                </div>
                {rows.length === 0 ? (
                  <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: "8px 0" }} />
                ) : (
                  <Table
                    size="small"
                    dataSource={rows}
                    rowKey="company"
                    pagination={false}
                    columns={[
                      { title: "#", render: (_, __, i) => i + 1, width: 40 },
                      { title: "Company", dataIndex: "company", key: "company" },
                      { title: "Entries", dataIndex: "entries", key: "entries", align: "center", width: 80 },
                      { title: "Total Volume", dataIndex: "totalVolume", key: "totalVolume", align: "right", width: 140,
                        render: v => <Text strong style={{ color }}>{(v || 0).toLocaleString()} m³</Text> },
                    ]}
                    style={{ marginBottom: 4 }}
                  />
                )}
              </div>
            );
          })}
        </Spin>
      </Modal>

      {/* ══════════════════════ LEACHATE PONDS MODAL ══════════════════════ */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #1890ff, #096dd9)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <WifiOutlined style={{ color: "#fff", fontSize: 16 }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1a3353" }}>Leachate Ponds Management</div>
              <div style={{ fontSize: 11, color: "#8c8c8c" }}>Count registered: {slfInfo?.noOfLeachatePond ?? "—"}</div>
            </div>
          </div>
        }
        open={leachateModalOpen}
        onCancel={() => setLeachateModalOpen(false)}
        footer={[
          <Button key="add" type="dashed" icon={<PlusOutlined />}
            onClick={() => setLeachateDetails(prev => [...prev, { _key: Date.now(), pondNo: prev.length + 1, description: "", status: "Active", attachments: [] }])}>
            Add Pond
          </Button>,
          <Button key="save" type="primary" loading={facilityMgmtSaving} icon={<SaveOutlined />}
            onClick={() => handleSaveFacilityDetails("leachate", leachateDetails)} style={{ background: "#1890ff" }}>
            Save
          </Button>,
          <Button key="close" onClick={() => setLeachateModalOpen(false)}>Close</Button>,
        ]}
        width={750}
        destroyOnHidden
      >
        {leachateDetails.length === 0 ? (
          <Empty description="No leachate pond records yet. Click 'Add Pond' to start." image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          leachateDetails.map((pond, idx) => (
            <div key={pond._key} style={{ background: "#f8f9fb", borderRadius: 10, padding: 16, marginBottom: 12, border: "1px solid #e8e8e8" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <Tag color="blue" style={{ fontWeight: 700 }}>Pond {idx + 1}</Tag>
                <Select
                  size="small"
                  value={pond.status || "Active"}
                  onChange={v => setLeachateDetails(p => p.map((x, i) => i === idx ? { ...x, status: v } : x))}
                  options={[{ label: "Active", value: "Active" }, { label: "Inactive", value: "Inactive" }, { label: "Under Maintenance", value: "Under Maintenance" }]}
                  style={{ width: 160 }}
                />
                <Button type="text" danger size="small" icon={<DeleteOutlined />} style={{ marginLeft: "auto" }}
                  onClick={() => setLeachateDetails(p => p.filter((_, i) => i !== idx))} />
              </div>
              <Row gutter={[12, 8]}>
                <Col xs={24} sm={8}>
                  <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}>Pond No.</div>
                  <InputNumber
                    size="small"
                    min={1}
                    value={pond.pondNo}
                    onChange={v => setLeachateDetails(p => p.map((x, i) => i === idx ? { ...x, pondNo: v } : x))}
                    style={{ width: "100%" }}
                  />
                </Col>
                <Col xs={24} sm={16}>
                  <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}>Description</div>
                  <Input
                    size="small"
                    value={pond.description}
                    placeholder="Pond description, dimensions, type..."
                    onChange={e => setLeachateDetails(p => p.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))}
                  />
                </Col>
              </Row>
              {/* Attachments */}
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}>Attachments / Document Links</div>
                {(pond.attachments || []).map((url, ai) => (
                  <div key={ai} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <Input
                      size="small"
                      value={url}
                      placeholder="Google Drive link or URL"
                      onChange={e => setLeachateDetails(p => p.map((x, i) => i === idx ? { ...x, attachments: x.attachments.map((a, j) => j === ai ? e.target.value : a) } : x))}
                      addonBefore={<FileTextOutlined />}
                    />
                    {url && <Button size="small" type="link" icon={<EyeOutlined />} href={url} target="_blank" style={{ padding: 0 }} />}
                    <Button size="small" danger type="text" icon={<DeleteOutlined />}
                      onClick={() => setLeachateDetails(p => p.map((x, i) => i === idx ? { ...x, attachments: x.attachments.filter((_, j) => j !== ai) } : x))} />
                  </div>
                ))}
                <Button size="small" type="dashed" icon={<PlusOutlined />}
                  onClick={() => setLeachateDetails(p => p.map((x, i) => i === idx ? { ...x, attachments: [...(x.attachments || []), ""] } : x))}>
                  Add Link
                </Button>
              </div>
            </div>
          ))
        )}
      </Modal>

      {/* ══════════════════════ GAS VENTS MODAL ══════════════════════ */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #52c41a, #389e0d)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <EnvironmentOutlined style={{ color: "#fff", fontSize: 16 }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1a3353" }}>Gas Vents Management</div>
              <div style={{ fontSize: 11, color: "#8c8c8c" }}>Count registered: {slfInfo?.numberOfGasVents ?? "—"}</div>
            </div>
          </div>
        }
        open={gasVentModalOpen}
        onCancel={() => setGasVentModalOpen(false)}
        footer={[
          <Button key="add" type="dashed" icon={<PlusOutlined />}
            onClick={() => setGasVentDetails(prev => [...prev, { _key: Date.now(), ventNo: prev.length + 1, ventType: "", description: "", status: "Active", attachments: [] }])}>
            Add Vent
          </Button>,
          <Button key="save" type="primary" loading={facilityMgmtSaving} icon={<SaveOutlined />}
            onClick={() => handleSaveFacilityDetails("gasVent", gasVentDetails)} style={{ background: "#52c41a", borderColor: "#52c41a" }}>
            Save
          </Button>,
          <Button key="close" onClick={() => setGasVentModalOpen(false)}>Close</Button>,
        ]}
        width={750}
        destroyOnHidden
      >
        {gasVentDetails.length === 0 ? (
          <Empty description="No gas vent records yet. Click 'Add Vent' to start." image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          gasVentDetails.map((vent, idx) => (
            <div key={vent._key} style={{ background: "#f6ffed", borderRadius: 10, padding: 16, marginBottom: 12, border: "1px solid #b7eb8f" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <Tag color="green" style={{ fontWeight: 700 }}>Vent {idx + 1}</Tag>
                <Select
                  size="small"
                  value={vent.status || "Active"}
                  onChange={v => setGasVentDetails(p => p.map((x, i) => i === idx ? { ...x, status: v } : x))}
                  options={[{ label: "Active", value: "Active" }, { label: "Inactive", value: "Inactive" }, { label: "Under Maintenance", value: "Under Maintenance" }]}
                  style={{ width: 160 }}
                />
                <Button type="text" danger size="small" icon={<DeleteOutlined />} style={{ marginLeft: "auto" }}
                  onClick={() => setGasVentDetails(p => p.filter((_, i) => i !== idx))} />
              </div>
              <Row gutter={[12, 8]}>
                <Col xs={24} sm={8}>
                  <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}>Vent No.</div>
                  <InputNumber size="small" min={1} value={vent.ventNo}
                    onChange={v => setGasVentDetails(p => p.map((x, i) => i === idx ? { ...x, ventNo: v } : x))}
                    style={{ width: "100%" }} />
                </Col>
                <Col xs={24} sm={8}>
                  <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}>Vent Type</div>
                  <Input size="small" value={vent.ventType} placeholder="e.g. Passive, Active"
                    onChange={e => setGasVentDetails(p => p.map((x, i) => i === idx ? { ...x, ventType: e.target.value } : x))} />
                </Col>
                <Col xs={24} sm={8}>
                  <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}>Description</div>
                  <Input size="small" value={vent.description} placeholder="Location, specs..."
                    onChange={e => setGasVentDetails(p => p.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} />
                </Col>
              </Row>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}>Attachments / Document Links</div>
                {(vent.attachments || []).map((url, ai) => (
                  <div key={ai} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <Input size="small" value={url} placeholder="Google Drive link or URL"
                      onChange={e => setGasVentDetails(p => p.map((x, i) => i === idx ? { ...x, attachments: x.attachments.map((a, j) => j === ai ? e.target.value : a) } : x))}
                      addonBefore={<FileTextOutlined />} />
                    {url && <Button size="small" type="link" icon={<EyeOutlined />} href={url} target="_blank" style={{ padding: 0 }} />}
                    <Button size="small" danger type="text" icon={<DeleteOutlined />}
                      onClick={() => setGasVentDetails(p => p.map((x, i) => i === idx ? { ...x, attachments: x.attachments.filter((_, j) => j !== ai) } : x))} />
                  </div>
                ))}
                <Button size="small" type="dashed" icon={<PlusOutlined />}
                  onClick={() => setGasVentDetails(p => p.map((x, i) => i === idx ? { ...x, attachments: [...(x.attachments || []), ""] } : x))}>
                  Add Link
                </Button>
              </div>
            </div>
          ))
        )}
      </Modal>

      {/* ══════════════════════ TRASH SLIDE PREVENTION MODAL ══════════════════════ */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #fa8c16, #d46b08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <AuditOutlined style={{ color: "#fff", fontSize: 16 }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1a3353" }}>Trash Slide Prevention Measures</div>
              <div style={{ fontSize: 11, color: "#8c8c8c" }}>{trashSlideDetails.length} measure(s) recorded</div>
            </div>
          </div>
        }
        open={trashSlideModalOpen}
        onCancel={() => setTrashSlideModalOpen(false)}
        footer={[
          <Button key="add" type="dashed" icon={<PlusOutlined />}
            onClick={() => setTrashSlideDetails(prev => [...prev, { _key: Date.now(), measure: "", description: "", status: "Implemented", attachments: [] }])}>
            Add Measure
          </Button>,
          <Button key="save" type="primary" loading={facilityMgmtSaving} icon={<SaveOutlined />}
            onClick={() => handleSaveFacilityDetails("trashSlide", trashSlideDetails)} style={{ background: "#fa8c16", borderColor: "#fa8c16" }}>
            Save
          </Button>,
          <Button key="close" onClick={() => setTrashSlideModalOpen(false)}>Close</Button>,
        ]}
        width={750}
        destroyOnHidden
      >
        {trashSlideDetails.length === 0 ? (
          <Empty description="No trash slide prevention measures yet. Click 'Add Measure' to start." image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          trashSlideDetails.map((item, idx) => (
            <div key={item._key} style={{ background: "#fff7e6", borderRadius: 10, padding: 16, marginBottom: 12, border: "1px solid #ffd591" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <Tag color="orange" style={{ fontWeight: 700 }}>Measure {idx + 1}</Tag>
                <Select
                  size="small"
                  value={item.status || "Implemented"}
                  onChange={v => setTrashSlideDetails(p => p.map((x, i) => i === idx ? { ...x, status: v } : x))}
                  options={[{ label: "Implemented", value: "Implemented" }, { label: "Planned", value: "Planned" }, { label: "Not Applicable", value: "Not Applicable" }]}
                  style={{ width: 160 }}
                />
                <Button type="text" danger size="small" icon={<DeleteOutlined />} style={{ marginLeft: "auto" }}
                  onClick={() => setTrashSlideDetails(p => p.filter((_, i) => i !== idx))} />
              </div>
              <Row gutter={[12, 8]}>
                <Col xs={24} sm={12}>
                  <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}>Measure Name</div>
                  <Input size="small" value={item.measure} placeholder="e.g. Slope stabilization, Retaining wall..."
                    onChange={e => setTrashSlideDetails(p => p.map((x, i) => i === idx ? { ...x, measure: e.target.value } : x))} />
                </Col>
                <Col xs={24} sm={12}>
                  <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}>Description</div>
                  <Input size="small" value={item.description} placeholder="Details, specifications..."
                    onChange={e => setTrashSlideDetails(p => p.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} />
                </Col>
              </Row>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}>Attachments / Document Links</div>
                {(item.attachments || []).map((url, ai) => (
                  <div key={ai} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <Input size="small" value={url} placeholder="Google Drive link or URL"
                      onChange={e => setTrashSlideDetails(p => p.map((x, i) => i === idx ? { ...x, attachments: x.attachments.map((a, j) => j === ai ? e.target.value : a) } : x))}
                      addonBefore={<FileTextOutlined />} />
                    {url && <Button size="small" type="link" icon={<EyeOutlined />} href={url} target="_blank" style={{ padding: 0 }} />}
                    <Button size="small" danger type="text" icon={<DeleteOutlined />}
                      onClick={() => setTrashSlideDetails(p => p.map((x, i) => i === idx ? { ...x, attachments: x.attachments.filter((_, j) => j !== ai) } : x))} />
                  </div>
                ))}
                <Button size="small" type="dashed" icon={<PlusOutlined />}
                  onClick={() => setTrashSlideDetails(p => p.map((x, i) => i === idx ? { ...x, attachments: [...(x.attachments || []), ""] } : x))}>
                  Add Link
                </Button>
              </div>
            </div>
          ))
        )}
      </Modal>

      {/* ══════════════════════ FIRE PREVENTION MODAL ══════════════════════ */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #ff4d4f, #cf1322)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CloseCircleOutlined style={{ color: "#fff", fontSize: 16 }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1a3353" }}>Fire Prevention Measures</div>
              <div style={{ fontSize: 11, color: "#8c8c8c" }}>{firePrevDetails.length} measure(s) recorded</div>
            </div>
          </div>
        }
        open={firePrevModalOpen}
        onCancel={() => setFirePrevModalOpen(false)}
        footer={[
          <Button key="add" type="dashed" icon={<PlusOutlined />}
            onClick={() => setFirePrevDetails(prev => [...prev, { _key: Date.now(), measure: "", description: "", status: "Implemented", attachments: [] }])}>
            Add Measure
          </Button>,
          <Button key="save" type="primary" danger loading={facilityMgmtSaving} icon={<SaveOutlined />}
            onClick={() => handleSaveFacilityDetails("firePrev", firePrevDetails)}>
            Save
          </Button>,
          <Button key="close" onClick={() => setFirePrevModalOpen(false)}>Close</Button>,
        ]}
        width={750}
        destroyOnHidden
      >
        {firePrevDetails.length === 0 ? (
          <Empty description="No fire prevention measures yet. Click 'Add Measure' to start." image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          firePrevDetails.map((item, idx) => (
            <div key={item._key} style={{ background: "#fff2f0", borderRadius: 10, padding: 16, marginBottom: 12, border: "1px solid #ffccc7" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <Tag color="red" style={{ fontWeight: 700 }}>Measure {idx + 1}</Tag>
                <Select
                  size="small"
                  value={item.status || "Implemented"}
                  onChange={v => setFirePrevDetails(p => p.map((x, i) => i === idx ? { ...x, status: v } : x))}
                  options={[{ label: "Implemented", value: "Implemented" }, { label: "Planned", value: "Planned" }, { label: "Not Applicable", value: "Not Applicable" }]}
                  style={{ width: 160 }}
                />
                <Button type="text" danger size="small" icon={<DeleteOutlined />} style={{ marginLeft: "auto" }}
                  onClick={() => setFirePrevDetails(p => p.filter((_, i) => i !== idx))} />
              </div>
              <Row gutter={[12, 8]}>
                <Col xs={24} sm={12}>
                  <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}>Measure Name</div>
                  <Input size="small" value={item.measure} placeholder="e.g. Fire suppression system, Firebreak..."
                    onChange={e => setFirePrevDetails(p => p.map((x, i) => i === idx ? { ...x, measure: e.target.value } : x))} />
                </Col>
                <Col xs={24} sm={12}>
                  <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}>Description</div>
                  <Input size="small" value={item.description} placeholder="Details, specifications..."
                    onChange={e => setFirePrevDetails(p => p.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} />
                </Col>
              </Row>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}>Attachments / Document Links</div>
                {(item.attachments || []).map((url, ai) => (
                  <div key={ai} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <Input size="small" value={url} placeholder="Google Drive link or URL"
                      onChange={e => setFirePrevDetails(p => p.map((x, i) => i === idx ? { ...x, attachments: x.attachments.map((a, j) => j === ai ? e.target.value : a) } : x))}
                      addonBefore={<FileTextOutlined />} />
                    {url && <Button size="small" type="link" icon={<EyeOutlined />} href={url} target="_blank" style={{ padding: 0 }} />}
                    <Button size="small" danger type="text" icon={<DeleteOutlined />}
                      onClick={() => setFirePrevDetails(p => p.map((x, i) => i === idx ? { ...x, attachments: x.attachments.filter((_, j) => j !== ai) } : x))} />
                  </div>
                ))}
                <Button size="small" type="dashed" icon={<PlusOutlined />}
                  onClick={() => setFirePrevDetails(p => p.map((x, i) => i === idx ? { ...x, attachments: [...(x.attachments || []), ""] } : x))}>
                  Add Link
                </Button>
              </div>
            </div>
          ))
        )}
      </Modal>

    </Layout>
  );
}
