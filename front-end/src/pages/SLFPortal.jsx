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
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import api from "../api";
import { useErrorCard } from "../utils/ErrorHandler";
import secureStorage from "../utils/secureStorage";
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
  actualVolume: null,
  actualVolumeUnit: "tons",
  wasteType: undefined,
  hazWasteCode: undefined,
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
  const [slfInfo, setSlfInfo] = useState(null);
  const [slfInfoLoading, setSlfInfoLoading] = useState(false);
  const [fieldLabels, setFieldLabels] = useState({});
  const [hazWasteCodes, setHazWasteCodes] = useState([]);
  const [historyDetailModal, setHistoryDetailModal] = useState(null);
  const [revertModalOpen, setRevertModalOpen] = useState(false);
  const [revertRecord, setRevertRecord] = useState(null);
  const [revertReason, setRevertReason] = useState("");
  const [revertLoading, setRevertLoading] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [extraTransportFields, setExtraTransportFields] = useState([]);
  // Address cascading dropdowns
  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [municipalities, setMunicipalities] = useState([]);
  const [barangays, setBarangays] = useState([]);

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
        if (f.section === "transport-info" && !KNOWN_TRANSPORT_KEYS.has(f.fieldKey)) {
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

  // Helper to get field label from settings, fallback to default
  const fl = (key, fallback) => fieldLabels[key]?.label || fallback;
  // Helper: is field required per admin settings? Falls back to defaultReq.
  const isRequired = (key, defaultReq = false) =>
    fieldLabels[key] ? fieldLabels[key].required : defaultReq;
  // Helper: get select options from settings, with fallback
  const opts = (key, fallback = []) =>
    fieldLabels[key]?.options?.length > 0 ? fieldLabels[key].options : fallback;

  // Load portal user from storage
  useEffect(() => {
    const token = secureStorage.get("portal_token");
    const user = secureStorage.getJSON("portal_user");
    if (!token || !user) {
      navigate("/slfportal/login");
      return;
    }
    setPortalUser(user);
    setLoadingUser(false);
  }, [navigate]);

  // Fetch SLF facility operational info
  useEffect(() => {
    if (!portalUser?.assignedSlf) return;
    const ac = new AbortController();
    setSlfInfoLoading(true);
    withRetry(
      () => api.get(`/slf-facilities/portal/${portalUser.assignedSlf}`, { signal: ac.signal }),
      { retries: 3, signal: ac.signal },
    ).then(({ data }) => setSlfInfo(data))
      .catch(() => {})
      .finally(() => setSlfInfoLoading(false));
    return () => ac.abort();
  }, [portalUser]);

  // Fetch existing baseline when user is loaded (with retry)
  useEffect(() => {
    if (!portalUser?.assignedSlfName) return;
    const ac = new AbortController();
    withRetry(
      () => api.get(`/data-slf/baseline/${encodeURIComponent(portalUser.assignedSlfName)}`, { signal: ac.signal }),
      { retries: 3, signal: ac.signal },
    ).then(({ data }) => {
        if (data && data.totalVolumeAccepted != null) {
          baselineForm.setFieldsValue({
            totalVolumeAccepted: data.totalVolumeAccepted,
            totalVolumeAcceptedUnit: data.totalVolumeAcceptedUnit || "m³",
            activeCellResidualVolume: data.activeCellResidualVolume,
            activeCellResidualUnit: data.activeCellResidualUnit || "m³",
            activeCellInertVolume: data.activeCellInertVolume,
            activeCellInertUnit: data.activeCellInertUnit || "m³",
            closedCellResidualVolume: data.closedCellResidualVolume,
            closedCellResidualUnit: data.closedCellResidualUnit || "m³",
            closedCellInertVolume: data.closedCellInertVolume,
            closedCellInertUnit: data.closedCellInertUnit || "m³",
          });
          if (data.accreditedHaulers?.length > 0) {
            setHaulers(
              data.accreditedHaulers.map((h, i) => {
                let vehicles = Array.isArray(h.vehicles) ? h.vehicles : [];
                if (vehicles.length === 0 && (h.plateNumber || h.vehicleType || h.capacity != null)) {
                  vehicles = [{ plateNumber: h.plateNumber || "", vehicleType: h.vehicleType || "", capacity: h.capacity, capacityUnit: h.capacityUnit || "m³" }];
                }
                return {
                  key: Date.now() + i,
                  ...h,
                  vehicles,
                  privateSectorClients: Array.isArray(h.privateSectorClients)
                    ? h.privateSectorClients
                    : h.privateSectorClients
                      ? [h.privateSectorClients]
                      : [],
                };
              }),
            );
          }
          setBaselineSaved(true);
          setActiveTab("disposal");
        }
      })
      .catch(() => {});
    return () => ac.abort();
  }, [portalUser]);

  // Fetch submission history
  const pollingRef = useRef(null);

  const fetchSubmissions = useCallback(async (silent = false) => {
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
      if (!silent) setLoadingSubmissions(false);
    }
  }, []);

  useEffect(() => {
    if (activeMenu === "history" && portalUser) {
      fetchSubmissions();
      // Poll every 15 seconds — but only when online
      pollingRef.current = setInterval(() => {
        if (navigator.onLine) fetchSubmissions(true);
      }, 15000);
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

  const handleLogout = () => {
    secureStorage.remove("portal_token");
    secureStorage.remove("portal_user");
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
    if (isRequired("hauler", true) && !truckDraft.hauler?.trim())
      errs.hauler = "Required";
    if (isRequired("plateNumber", true) && !truckDraft.plateNumber?.trim())
      errs.plateNumber = "Required";
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
        vehicles,
        privateSectorClients: Array.isArray(record.privateSectorClients)
          ? record.privateSectorClients
          : record.privateSectorClients
            ? [record.privateSectorClients]
            : [],
      });
    } else {
      setEditingHaulerKey(null);
      setHaulerDraft({ ...EMPTY_HAULER });
    }
    setHaulerErrors({});
    setHaulerModalOpen(true);
  };

  const handleSaveHauler = () => {
    if (!validateHauler()) return;
    if (editingHaulerKey) {
      setHaulers((prev) =>
        prev.map((h) =>
          h.key === editingHaulerKey ? { ...h, ...haulerDraft } : h,
        ),
      );
    } else {
      setHaulers((prev) => [...prev, { key: Date.now(), ...haulerDraft }]);
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
        truckCapacityUnit: record.truckCapacityUnit || "m³",
        actualVolume: record.actualVolume,
        actualVolumeUnit: record.actualVolumeUnit || "tons",
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
      const draft = { ...EMPTY_TRUCK };
      // Initialize additional transport fields with defaults
      extraTransportFields.forEach((f) => {
        draft[f.fieldKey] = f.fieldType === "number" ? null : "";
      });
      setTruckDraft(draft);
    }
    setTruckErrors({});
    setTruckModalOpen(true);
  };

  const handleSaveTruck = () => {
    if (!validateTruck()) return;
    if (editingTruckKey) {
      setTrucks((prev) =>
        prev.map((t) =>
          t.key === editingTruckKey ? { ...t, ...truckDraft } : t,
        ),
      );
    } else {
      setTrucks((prev) => [...prev, { key: Date.now(), ...truckDraft }]);
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
      await api.patch(`/data-slf/${revertRecord._id}/request-revert`, {
        reason: revertReason,
        requestedBy: portalUser?.email,
      });
      setRevertModalOpen(false);
      setRevertRecord(null);
      setRevertReason("");
      fetchSubmissions();
      Swal.fire({
        icon: "success",
        title: "Revert Requested",
        html: "Your request has been sent. The admin will review it. You may also email <b>emb_region3@emb.gov.ph</b> for follow-up.",
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
      const entry = {
        ...disposalValues,
        ...baselineValues,
        ...companyValues,
        accreditedHaulers: haulers.map(({ key, ...rest }) => rest),
        slfName: portalUser?.assignedSlfName,
        dateOfDisposal: disposalValues.dateOfDisposal
          ? disposalValues.dateOfDisposal.format("YYYY-MM-DD")
          : null,
        trucks: trucks.map(({ key, ...rest }) => rest),
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
    { title: "Plate No.", dataIndex: "plateNumber", key: "plateNumber" },
    {
      title: "Capacity",
      key: "cap",
      render: (_, t) =>
        t.truckCapacity
          ? `${t.truckCapacity} ${(t.truckCapacityUnit || "m³").replace("m3", "m³")}`
          : "—",
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
        return arr.length > 0 ? arr.join(", ") : "—";
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
          <Button
            type="text"
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => removeHauler(h.key)}
          />
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
      render: (v) => (v ? dayjs(v).format("MMM D, YYYY") : "—"),
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
      width: 120,
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
          {r.status === "acknowledged" && !r.revertRequested && (
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

  const menuItems = [
    { key: "data-entry", icon: <FileTextOutlined />, label: "Data Entry" },
    { key: "history", icon: <HistoryOutlined />, label: "Submission History" },
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
            {portalUser?.assignedSlfName}
          </Tag>
        </div>
      ),
      disabled: true,
    },
    { type: "divider" },
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
        {/* SLF Name (read-only, from assigned SLF) */}
        <Card
          className="slf-section"
          title={
            <Space wrap>
              <FileTextOutlined style={{ color: "#1a3353" }} />
              <Text
                strong
                style={{ fontSize: isMobile ? 14 : 16, color: "#1a3353" }}
              >
                {isMobile
                  ? "Assigned SLF"
                  : "Assigned Sanitary Landfill Facility (SLF)"}
              </Text>
            </Space>
          }
          extra={
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleReviewOpen}
              loading={loading}
              className="slf-primary-btn"
              size={isMobile ? "middle" : "large"}
            >
              {isMobile ? "Submit" : "Review & Submit"}
            </Button>
          }
        >
          <Tag color="blue" style={{ fontSize: 14, padding: "4px 12px", marginBottom: 12 }}>
            {portalUser?.assignedSlfName}
          </Tag>

          {slfInfoLoading ? (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <Spin size="small" /> <Text type="secondary" style={{ marginLeft: 8 }}>Loading facility info...</Text>
            </div>
          ) : slfInfo ? (
            <Descriptions
              bordered
              size="small"
              column={{ xs: 1, sm: 2, md: 3 }}
              style={{ marginTop: 4 }}
              labelStyle={{ fontWeight: 600, background: "#f5f7fa", whiteSpace: "nowrap" }}
            >
              <Descriptions.Item label="Status">
                <Tag color={slfInfo.statusOfSLF?.toLowerCase().includes("non") ? "red" : slfInfo.statusOfSLF?.toLowerCase().includes("operational") ? "green" : "default"}>
                  {slfInfo.statusOfSLF || "Not yet monitored"}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Category">{slfInfo.category || "—"}</Descriptions.Item>
              <Descriptions.Item label="Year Started">{slfInfo.yearStartedOperation || "—"}</Descriptions.Item>
              <Descriptions.Item label="No. of Cells">{slfInfo.numberOfCell ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Volume Capacity">
                {slfInfo.volumeCapacity != null ? `${slfInfo.volumeCapacity.toLocaleString()} m³` : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Remaining Lifespan">{slfInfo.remainingLifeSpan || "—"}</Descriptions.Item>
              <Descriptions.Item label="Actual Waste Received">
                {slfInfo.actualResidualWasteReceived != null ? `${slfInfo.actualResidualWasteReceived.toLocaleString()} tons` : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Leachate Ponds">{slfInfo.noOfLeachatePond ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Gas Vents">{slfInfo.numberOfGasVents ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Location">
                {[slfInfo.barangay, slfInfo.lgu, slfInfo.province].filter(Boolean).join(", ") || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Ownership">{slfInfo.ownership || "—"}</Descriptions.Item>
              <Descriptions.Item label="MRF Established">{slfInfo.mrfEstablished || "—"}</Descriptions.Item>
            </Descriptions>
          ) : (
            <div style={{ background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: 6, padding: "10px 16px", marginTop: 4 }}>
              <InfoCircleOutlined style={{ color: "#faad14", marginRight: 8 }} />
              <Text style={{ color: "#ad6800" }}>
                SLF operational data is currently being processed. Monitoring is ongoing — details will appear here once available.
              </Text>
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
                          Baseline data has been saved. You can update it here
                          or proceed to the Disposal Report tab.
                        </Text>
                      </div>
                    )}
                    <Form
                      form={baselineForm}
                      layout="vertical"
                      requiredMark={false}
                    >
                      <Divider
                        titlePlacement="left"
                        className="slf-category-divider"
                      >
                        Volume of Waste Accepted
                      </Divider>
                      <Row gutter={[12, 0]}>
                        <Col xs={16} sm={10} md={8}>
                          <Form.Item
                            name="totalVolumeAccepted"
                            label={
                              isMobile
                                ? "Total Volume Accepted"
                                : "Total Volume of Waste Accepted (since start of operation)"
                            }
                            rules={[{ required: true, message: "Required" }]}
                          >
                            <InputNumber
                              placeholder="Volume"
                              style={{ width: "100%" }}
                              min={0}
                              step={0.01}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={8} sm={4} md={3}>
                          <Form.Item
                            name="totalVolumeAcceptedUnit"
                            label="Unit"
                            initialValue="m³"
                          >
                            <Select>
                              <Option value="m³">
                                m<sup>3</sup>
                              </Option>
                              <Option value="tons">Tons</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                      </Row>

                      <Divider
                        titlePlacement="left"
                        className="slf-category-divider"
                      >
                        Total Volume Disposed in Active Cells
                      </Divider>
                      <Row gutter={[12, 0]}>
                        <Col xs={16} sm={10} md={5}>
                          <Form.Item
                            name="activeCellResidualVolume"
                            label="Residual"
                            rules={[{ required: true, message: "Required" }]}
                          >
                            <InputNumber
                              placeholder="Volume"
                              style={{ width: "100%" }}
                              min={0}
                              step={0.01}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={8} sm={4} md={3}>
                          <Form.Item
                            name="activeCellResidualUnit"
                            label="Unit"
                            initialValue="m³"
                          >
                            <Select>
                              <Option value="m³">
                                m<sup>3</sup>
                              </Option>
                              <Option value="tons">Tons</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                        <Col xs={16} sm={10} md={5}>
                          <Form.Item
                            name="activeCellInertVolume"
                            label="Inert"
                            rules={[{ required: true, message: "Required" }]}
                          >
                            <InputNumber
                              placeholder="Volume"
                              style={{ width: "100%" }}
                              min={0}
                              step={0.01}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={8} sm={4} md={3}>
                          <Form.Item
                            name="activeCellInertUnit"
                            label="Unit"
                            initialValue="m³"
                          >
                            <Select>
                              <Option value="m³">
                                m<sup>3</sup>
                              </Option>
                              <Option value="tons">Tons</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                      </Row>

                      <Divider
                        titlePlacement="left"
                        className="slf-category-divider"
                      >
                        Total Volume Disposed in Closed Cells
                      </Divider>
                      <Row gutter={[12, 0]}>
                        <Col xs={16} sm={10} md={5}>
                          <Form.Item
                            name="closedCellResidualVolume"
                            label="Residual"
                            rules={[{ required: true, message: "Required" }]}
                          >
                            <InputNumber
                              placeholder="Volume"
                              style={{ width: "100%" }}
                              min={0}
                              step={0.01}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={8} sm={4} md={3}>
                          <Form.Item
                            name="closedCellResidualUnit"
                            label="Unit"
                            initialValue="m³"
                          >
                            <Select>
                              <Option value="m³">
                                m<sup>3</sup>
                              </Option>
                              <Option value="tons">Tons</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                        <Col xs={16} sm={10} md={5}>
                          <Form.Item
                            name="closedCellInertVolume"
                            label="Inert"
                            rules={[{ required: true, message: "Required" }]}
                          >
                            <InputNumber
                              placeholder="Volume"
                              style={{ width: "100%" }}
                              min={0}
                              step={0.01}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={8} sm={4} md={3}>
                          <Form.Item
                            name="closedCellInertUnit"
                            label="Unit"
                            initialValue="m³"
                          >
                            <Select>
                              <Option value="m³">
                                m<sup>3</sup>
                              </Option>
                              <Option value="tons">Tons</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                      </Row>

                      <Divider
                        titlePlacement="left"
                        className="slf-category-divider"
                      >
                        <TeamOutlined /> Accredited Haulers
                      </Divider>
                      <div style={{ marginBottom: 12 }}>
                        <Button
                          type="primary"
                          icon={<PlusOutlined />}
                          className="slf-primary-btn"
                          onClick={() => openHaulerModal(null)}
                        >
                          Add Hauler
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
                          <DatePicker style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={[12, 0]}>
                      <Col xs={24} sm={14} md={12}>
                        <Form.Item
                          name="lguCompanyName"
                          label={fl("lguCompanyName", "LGU/Company Name")}
                          rules={[
                            {
                              required: isRequired("lguCompanyName", true),
                              message: "Required",
                            },
                          ]}
                        >
                          <Input placeholder="e.g. Dela Cruz, Juan" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={10} md={6}>
                        <Form.Item
                          name="companyType"
                          label={fl("companyType", "Company Type")}
                          rules={[
                            {
                              required: isRequired("companyType", true),
                              message: "Required",
                            },
                          ]}
                        >
                          <Select placeholder="Select type">
                            {opts("companyType", ["LGU", "Private"]).map(
                              (o) => (
                                <Option key={o} value={o}>
                                  {o}
                                </Option>
                              ),
                            )}
                          </Select>
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={[12, 0]}>
                      <Col xs={24}>
                        <Form.Item
                          name="address"
                          label={fl("address", "Address")}
                          rules={[
                            {
                              required: isRequired("address", false),
                              message: "Required",
                            },
                          ]}
                        >
                          <Input placeholder="Complete address" />
                        </Form.Item>
                      </Col>
                    </Row>

                    <Divider
                      titlePlacement="left"
                      className="slf-category-divider"
                    >
                      <CarOutlined /> Transport and Disposal Information
                    </Divider>

                    <Table
                      dataSource={trucks}
                      columns={truckColumns}
                      rowKey="key"
                      size="small"
                      pagination={false}
                      scroll={{ x: 900 }}
                      locale={{
                        emptyText: (
                          <Text type="secondary" style={{ fontSize: 13 }}>
                            No entries added. Click "Add Entry" below to add
                            transport data.
                          </Text>
                        ),
                      }}
                    />
                    <div style={{ marginTop: 12, marginBottom: 16 }}>
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        className="slf-primary-btn"
                        onClick={() => openTruckModal(null)}
                      >
                        Add Entry
                      </Button>
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

  // ── History Content ──
  const renderHistory = () => (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
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
          scroll={{ x: 900 }}
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
          width={240}
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
          <Dropdown
            menu={{
              items: userMenuItems,
              onClick: ({ key }) => {
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
          expandIconPosition="end"
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
                    <Col xs={24}>
                      <Form.Item label="Office Address">
                        <Input
                          placeholder="Office address"
                          value={haulerDraft.officeAddress}
                          onChange={(e) =>
                            updateHaulerDraft("officeAddress", e.target.value)
                          }
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
                              <Option value="tons">Tons</Option>
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
                <Row gutter={[12, 0]}>
                  <Col xs={24}>
                    <Form.Item label="Private Sector/LGU Clients">
                      <Select
                        mode="tags"
                        placeholder="Type and press Enter to add clients"
                        value={haulerDraft.privateSectorClients}
                        onChange={(v) =>
                          updateHaulerDraft("privateSectorClients", v)
                        }
                        tokenSeparators={[","]}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              ),
            },
          ]}
        />
      </Modal>

      {/* ── Truck Entry Modal ── */}
      <Modal
        title={editingTruckKey ? "Edit Transport Entry" : "Add Transport Entry"}
        open={truckModalOpen}
        onCancel={() => {
          setTruckModalOpen(false);
          setTruckErrors({});
        }}
        onOk={handleSaveTruck}
        okText={editingTruckKey ? "Update" : "Add"}
        okButtonProps={{ className: "slf-primary-btn" }}
        destroyOnHidden
        width={900}
      >
        <Collapse
          defaultActiveKey={["trip", "vehicle", "waste"]}
          bordered={false}
          expandIconPosition="end"
          style={{ background: "transparent" }}
          items={[
            {
              key: "trip",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <FileTextOutlined /> Trip Information
                </Text>
              ),
              children: (
                <Row gutter={[12, 0]}>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      label={fl(
                        "disposalTicketNo",
                        "Disposal/Trip Ticket No.",
                      )}
                      {...fieldErr("disposalTicketNo")}
                    >
                      <Input
                        placeholder="Ticket number"
                        value={truckDraft.disposalTicketNo}
                        onChange={(e) =>
                          updateTruckDraft(
                            "disposalTicketNo",
                            e.target.value,
                          )
                        }
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      label={fl("hauler", "Hauler")}
                      required={isRequired("hauler", true)}
                      {...fieldErr("hauler")}
                    >
                      <Input
                        placeholder="Hauler name"
                        value={truckDraft.hauler}
                        onChange={(e) =>
                          updateTruckDraft("hauler", e.target.value)
                        }
                      />
                    </Form.Item>
                  </Col>
                </Row>
              ),
            },
            {
              key: "vehicle",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <CarOutlined /> Vehicle & Capacity
                </Text>
              ),
              children: (
                <Row gutter={[12, 0]}>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      label={fl("plateNumber", "Plate Number")}
                      required={isRequired("plateNumber", true)}
                      {...fieldErr("plateNumber")}
                    >
                      <Input
                        placeholder="e.g. ABC-1234"
                        value={truckDraft.plateNumber}
                        onChange={(e) =>
                          updateTruckDraft("plateNumber", e.target.value)
                        }
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8}>
                    <Form.Item
                      label={fl("truckCapacity", "Truck Capacity")}
                    >
                      <InputNumber
                        placeholder="Cap."
                        style={{ width: "100%" }}
                        min={0}
                        step={0.1}
                        value={truckDraft.truckCapacity}
                        onChange={(v) =>
                          updateTruckDraft("truckCapacity", v)
                        }
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={4}>
                    <Form.Item label="Unit">
                      <Select
                        value={truckDraft.truckCapacityUnit}
                        onChange={(v) =>
                          updateTruckDraft("truckCapacityUnit", v)
                        }
                      >
                        <Option value="m³">
                          m<sup>3</sup>
                        </Option>
                        <Option value="tons">Tons</Option>
                      </Select>
                    </Form.Item>
                  </Col>
                </Row>
              ),
            },
            {
              key: "waste",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <DatabaseOutlined /> Waste Details
                </Text>
              ),
              children: (
                <>
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
                          onChange={(v) =>
                            updateTruckDraft("actualVolume", v)
                          }
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={4}>
                      <Form.Item label="Unit">
                        <Select
                          value={truckDraft.actualVolumeUnit}
                          onChange={(v) =>
                            updateTruckDraft("actualVolumeUnit", v)
                          }
                        >
                          <Option value="tons">Tons</Option>
                          <Option value="m³">
                            m<sup>3</sup>
                          </Option>
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
                          placeholder="Select"
                          value={truckDraft.wasteType}
                          onChange={(v) =>
                            updateTruckDraft("wasteType", v)
                          }
                        >
                          {opts("wasteType", [
                            "Residual",
                            "Hazardous Waste",
                          ]).map((o) => (
                            <Option key={o} value={o}>
                              {o}
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>
                  </Row>
                  {truckDraft.wasteType === "Hazardous Waste" && (
                    <Row gutter={[12, 0]}>
                      <Col xs={24} sm={12}>
                        <Form.Item label="Hazardous Waste Code (DENR EMB)">
                          <Select
                            placeholder="Select code (e.g. M501)"
                            value={truckDraft.hazWasteCode}
                            onChange={(v) =>
                              updateTruckDraft("hazWasteCode", v)
                            }
                            showSearch
                            allowClear
                          >
                            {hazWasteCodes.map((code) => (
                              <Option key={code} value={code}>
                                {code}
                              </Option>
                            ))}
                          </Select>
                        </Form.Item>
                      </Col>
                    </Row>
                  )}
                </>
              ),
            },
            ...(extraTransportFields.length > 0
              ? [
                  {
                    key: "additional",
                    label: (
                      <Text strong style={{ color: "#1a3353" }}>
                        <PlusOutlined /> Additional Fields
                      </Text>
                    ),
                    children: (
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
                                  onChange={(v) =>
                                    updateTruckDraft(f.fieldKey, v)
                                  }
                                />
                              ) : f.fieldType === "select" ? (
                                <Select
                                  placeholder={`Select ${f.fieldName}`}
                                  value={truckDraft[f.fieldKey] || undefined}
                                  onChange={(v) =>
                                    updateTruckDraft(f.fieldKey, v)
                                  }
                                  allowClear
                                >
                                  {(f.options || []).map((o) => (
                                    <Option key={o} value={o}>
                                      {o}
                                    </Option>
                                  ))}
                                </Select>
                              ) : f.fieldType === "date" ? (
                                <DatePicker
                                  style={{ width: "100%" }}
                                  value={truckDraft[f.fieldKey]}
                                  onChange={(v) =>
                                    updateTruckDraft(f.fieldKey, v)
                                  }
                                />
                              ) : f.fieldType === "textarea" ? (
                                <TextArea
                                  rows={2}
                                  placeholder={f.fieldName}
                                  value={truckDraft[f.fieldKey]}
                                  onChange={(e) =>
                                    updateTruckDraft(
                                      f.fieldKey,
                                      e.target.value,
                                    )
                                  }
                                />
                              ) : (
                                <Input
                                  placeholder={f.fieldName}
                                  value={truckDraft[f.fieldKey]}
                                  onChange={(e) =>
                                    updateTruckDraft(
                                      f.fieldKey,
                                      e.target.value,
                                    )
                                  }
                                />
                              )}
                            </Form.Item>
                          </Col>
                        ))}
                      </Row>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Modal>

      {/* ── Submission Detail Modal ── */}
      <Modal
        title={
          historyDetailModal ? (
            <Space>
              <FileTextOutlined style={{ color: "#1a3353" }} />
              <span>Submission Details — {historyDetailModal.idNo}</span>
            </Space>
          ) : (
            "Submission Details"
          )
        }
        open={!!historyDetailModal}
        onCancel={() => setHistoryDetailModal(null)}
        footer={null}
        width={840}
        destroyOnHidden
      >
        {historyDetailModal && (
          <Collapse
            defaultActiveKey={["summary", "baseline", "haulers", "transport"]}
            bordered={false}
            expandIconPosition="end"
            style={{ background: "transparent" }}
            items={[
              {
                key: "summary",
                label: (
                  <Text strong style={{ color: "#1a3353" }}>
                    <InfoCircleOutlined /> Submission Summary
                  </Text>
                ),
                children: (
                  <Descriptions
                    bordered
                    size="small"
                    column={{ xs: 1, sm: 2 }}
                  >
                    <Descriptions.Item label="ID No.">
                      {historyDetailModal.idNo}
                    </Descriptions.Item>
                    <Descriptions.Item label="Status">
                      {renderStatusTag(
                        historyDetailModal.status,
                        historyDetailModal,
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="Date of Disposal">
                      {historyDetailModal.dateOfDisposal
                        ? dayjs(historyDetailModal.dateOfDisposal).format(
                            "MMM D, YYYY",
                          )
                        : "—"}
                    </Descriptions.Item>
                    <Descriptions.Item label="Submitted">
                      {dayjs(historyDetailModal.createdAt).format(
                        "MMM D, YYYY h:mm A",
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="Company">
                      {historyDetailModal.lguCompanyName}
                    </Descriptions.Item>
                    <Descriptions.Item label="Company Type">
                      <Tag
                        color={
                          historyDetailModal.companyType === "LGU"
                            ? "blue"
                            : "green"
                        }
                      >
                        {historyDetailModal.companyType}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="Address" span={2}>
                      {historyDetailModal.address || "—"}
                    </Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                key: "baseline",
                label: (
                  <Text strong style={{ color: "#1a3353" }}>
                    <DatabaseOutlined /> Baseline Data
                  </Text>
                ),
                children: (
                  <Descriptions
                    bordered
                    size="small"
                    column={{ xs: 1, sm: 2 }}
                  >
                    <Descriptions.Item label="Total Volume Accepted">
                      {historyDetailModal.totalVolumeAccepted != null
                        ? `${historyDetailModal.totalVolumeAccepted} ${(historyDetailModal.totalVolumeAcceptedUnit || "m³").replace("m3", "m³")}`
                        : "—"}
                    </Descriptions.Item>
                    <Descriptions.Item label="Active Cell - Residual">
                      {historyDetailModal.activeCellResidualVolume != null
                        ? `${historyDetailModal.activeCellResidualVolume} ${(historyDetailModal.activeCellResidualUnit || "m³").replace("m3", "m³")}`
                        : "—"}
                    </Descriptions.Item>
                    <Descriptions.Item label="Active Cell - Inert">
                      {historyDetailModal.activeCellInertVolume != null
                        ? `${historyDetailModal.activeCellInertVolume} ${(historyDetailModal.activeCellInertUnit || "m³").replace("m3", "m³")}`
                        : "—"}
                    </Descriptions.Item>
                    <Descriptions.Item label="Closed Cell - Residual">
                      {historyDetailModal.closedCellResidualVolume != null
                        ? `${historyDetailModal.closedCellResidualVolume} ${(historyDetailModal.closedCellResidualUnit || "m³").replace("m3", "m³")}`
                        : "—"}
                    </Descriptions.Item>
                    <Descriptions.Item label="Closed Cell - Inert">
                      {historyDetailModal.closedCellInertVolume != null
                        ? `${historyDetailModal.closedCellInertVolume} ${(historyDetailModal.closedCellInertUnit || "m³").replace("m3", "m³")}`
                        : "—"}
                    </Descriptions.Item>
                  </Descriptions>
                ),
              },
              ...(historyDetailModal.accreditedHaulers?.length > 0
                ? [
                    {
                      key: "haulers",
                      label: (
                        <Text strong style={{ color: "#1a3353" }}>
                          <TeamOutlined /> Accredited Haulers (
                          {historyDetailModal.accreditedHaulers.length})
                        </Text>
                      ),
                      children: (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          {historyDetailModal.accreditedHaulers.map((h, i) => {
                            const clients = Array.isArray(h.privateSectorClients)
                              ? h.privateSectorClients
                              : h.privateSectorClients ? [h.privateSectorClients] : [];
                            return (
                              <Card
                                key={i}
                                size="small"
                                style={{ background: "#fafafa", borderColor: "#e8e8e8" }}
                                title={<Text strong style={{ fontSize: 13 }}>Hauler #{i + 1}</Text>}
                              >
                                <Row gutter={[16, 8]}>
                                  <Col xs={24} sm={12}>
                                    <Text type="secondary" style={{ fontSize: 12 }}>Hauler Name</Text>
                                    <div><Text strong>{h.haulerName || "—"}</Text></div>
                                  </Col>
                                  <Col xs={12} sm={6}>
                                    <Text type="secondary" style={{ fontSize: 12 }}>No. of Trucks</Text>
                                    <div><Text strong>{h.numberOfTrucks ?? "—"}</Text></div>
                                  </Col>
                                  <Col xs={12} sm={6}>
                                    <Text type="secondary" style={{ fontSize: 12 }}>Vehicle Type</Text>
                                    <div><Text strong>{h.vehicleType || "—"}</Text></div>
                                  </Col>
                                  <Col xs={12} sm={6}>
                                    <Text type="secondary" style={{ fontSize: 12 }}>Plate Number</Text>
                                    <div><Text strong>{h.plateNumber || "—"}</Text></div>
                                  </Col>
                                  <Col xs={12} sm={6}>
                                    <Text type="secondary" style={{ fontSize: 12 }}>Capacity</Text>
                                    <div><Text strong>{h.capacity != null ? `${h.capacity} ${(h.capacityUnit || "m³").replace("m3", "m³")}` : "—"}</Text></div>
                                  </Col>
                                  <Col xs={24} sm={12}>
                                    <Text type="secondary" style={{ fontSize: 12 }}>Office Address</Text>
                                    <div><Text strong>{h.officeAddress || "—"}</Text></div>
                                  </Col>
                                  <Col xs={24}>
                                    <Text type="secondary" style={{ fontSize: 12 }}>Private Sector/LGU Clients</Text>
                                    <div><Text strong>{clients.length > 0 ? clients.join(", ") : "—"}</Text></div>
                                  </Col>
                                </Row>
                              </Card>
                            );
                          })}
                        </div>
                      ),
                    },
                  ]
                : []),
              {
                key: "transport",
                label: (
                  <Text strong style={{ color: "#1a3353" }}>
                    <CarOutlined /> Transport & Disposal Information (
                    {(historyDetailModal.trucks || []).length} entries)
                  </Text>
                ),
                children: (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {(historyDetailModal.trucks || []).map((t, i) => (
                      <Card
                        key={i}
                        size="small"
                        style={{ background: "#fafafa", borderColor: "#e8e8e8" }}
                        title={<Text strong style={{ fontSize: 13 }}>Entry #{i + 1}</Text>}
                      >
                        <Row gutter={[16, 8]}>
                          <Col xs={12} sm={8}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Ticket No.</Text>
                            <div><Text strong>{t.disposalTicketNo || "—"}</Text></div>
                          </Col>
                          <Col xs={12} sm={8}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Hauler</Text>
                            <div><Text strong>{t.hauler || "—"}</Text></div>
                          </Col>
                          <Col xs={12} sm={8}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Plate No.</Text>
                            <div><Text strong>{t.plateNumber || "—"}</Text></div>
                          </Col>
                          <Col xs={12} sm={6}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Truck Capacity</Text>
                            <div><Text strong>{t.truckCapacity ? `${t.truckCapacity} ${(t.truckCapacityUnit || "m³").replace("m3", "m³")}` : "—"}</Text></div>
                          </Col>
                          <Col xs={12} sm={6}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Actual Volume</Text>
                            <div><Text strong>{t.actualVolume != null ? `${t.actualVolume} ${t.actualVolumeUnit || "tons"}` : "—"}</Text></div>
                          </Col>
                          <Col xs={12} sm={6}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Waste Type</Text>
                            <div><Text strong>{t.wasteType || "—"}</Text></div>
                          </Col>
                          <Col xs={12} sm={6}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Haz. Code</Text>
                            <div><Text strong>{t.hazWasteCode || "—"}</Text></div>
                          </Col>
                        </Row>
                      </Card>
                    ))}
                    {(historyDetailModal.trucks || []).length === 0 && (
                      <Text type="secondary" style={{ textAlign: "center", padding: 16 }}>
                        No transport entries recorded.
                      </Text>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Modal>

      {/* ── Review Submission Modal ── */}
      <Modal
        title={
          <Space>
            <EyeOutlined style={{ color: "#1a3353" }} />
            <span>Review Submission</span>
          </Space>
        }
        open={reviewModalOpen}
        onCancel={() => setReviewModalOpen(false)}
        onOk={handleConfirmSubmit}
        okText="Confirm & Submit"
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
        <Collapse
          defaultActiveKey={[
            "company",
            "baseline",
            "disposal",
            "haulers",
            "transport",
          ]}
          bordered={false}
          expandIconPosition="end"
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
                        ).format("MMM D, YYYY")
                      : "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="LGU/Company Name">
                    {entryForm.getFieldValue("lguCompanyName") || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Company Type">
                    {entryForm.getFieldValue("companyType") || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Address">
                    {entryForm.getFieldValue("address") || "—"}
                  </Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: "baseline",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <DatabaseOutlined /> Baseline Data
                </Text>
              ),
              children: (
                <Descriptions
                  bordered
                  size="small"
                  column={{ xs: 1, sm: 2 }}
                >
                  <Descriptions.Item label="Total Volume Accepted">
                    {baselineForm.getFieldValue("totalVolumeAccepted") !=
                    null
                      ? `${baselineForm.getFieldValue("totalVolumeAccepted")} ${(baselineForm.getFieldValue("totalVolumeAcceptedUnit") || "m³").replace("m3", "m³")}`
                      : "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Active Cell - Residual">
                    {baselineForm.getFieldValue(
                      "activeCellResidualVolume",
                    ) != null
                      ? `${baselineForm.getFieldValue("activeCellResidualVolume")} ${(baselineForm.getFieldValue("activeCellResidualUnit") || "m³").replace("m3", "m³")}`
                      : "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Active Cell - Inert">
                    {baselineForm.getFieldValue("activeCellInertVolume") !=
                    null
                      ? `${baselineForm.getFieldValue("activeCellInertVolume")} ${(baselineForm.getFieldValue("activeCellInertUnit") || "m³").replace("m3", "m³")}`
                      : "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Closed Cell - Residual">
                    {baselineForm.getFieldValue(
                      "closedCellResidualVolume",
                    ) != null
                      ? `${baselineForm.getFieldValue("closedCellResidualVolume")} ${(baselineForm.getFieldValue("closedCellResidualUnit") || "m³").replace("m3", "m³")}`
                      : "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Closed Cell - Inert">
                    {baselineForm.getFieldValue("closedCellInertVolume") !=
                    null
                      ? `${baselineForm.getFieldValue("closedCellInertVolume")} ${(baselineForm.getFieldValue("closedCellInertUnit") || "m³").replace("m3", "m³")}`
                      : "—"}
                  </Descriptions.Item>
                </Descriptions>
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
                    { title: "Plate No.", dataIndex: "plateNumber" },
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
    </Layout>
  );
}
