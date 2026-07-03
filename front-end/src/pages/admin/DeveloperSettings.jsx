import { useState, useEffect, useRef, useCallback } from "react";
import {
  Card,
  Typography,
  Form,
  Input,
  Select,
  Switch,
  InputNumber,
  Button,
  Divider,
  Row,
  Col,
  Spin,
  Tag,
  Descriptions,
  Space,
  Badge,
  Popconfirm,
  Tabs,
  Tooltip,
  Empty,
  Alert,
  DatePicker,
  Modal,
} from "antd";
import {
  SettingOutlined,
  MailOutlined,
  LockOutlined,
  ToolOutlined,
  GlobalOutlined,
  BgColorsOutlined,
  SaveOutlined,
  DatabaseOutlined,
  UserOutlined,
  FileTextOutlined,
  ReloadOutlined,
  DeleteOutlined,
  TeamOutlined,
  UndoOutlined,
  ExclamationCircleOutlined,
  NotificationOutlined,
  DashboardOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  ApartmentOutlined,
  ContainerOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SearchOutlined,
  FundProjectionScreenOutlined,
  BankOutlined,
  CarOutlined,
  SafetyCertificateOutlined,
  SwapOutlined,
  BarChartOutlined,
  EnvironmentOutlined,
  AimOutlined,
  HistoryOutlined,
  SendOutlined,
  PlusOutlined,
  EditOutlined,
  UnlockOutlined,
  DisconnectOutlined,
  ApiOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ExperimentOutlined,
  FolderOpenOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import AccountSettings from "./AccountSettings";
import Swal from "sweetalert2";
import api from "../../api";
import secureStorage from "../../utils/secureStorage";
import dayjs from "dayjs";
import ResponsiveTable from "./shared/ResponsiveTable";
import DummyDataConfig from "./DummyDataConfig";
import SLFDataTableFiles from "./SLFDataTableFiles";

const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

export default function DeveloperSettings({onSettingsSaved, isDark, isDeveloper = false, initialActiveKey = "general"}) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [announcementEmailSending, setAnnouncementEmailSending] = useState(false);
  const [announcements, setAnnouncements] = useState([]);
  const [announcementModal, setAnnouncementModal] = useState({ open: false, record: null });
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const [form] = Form.useForm();
  const [announcementForm] = Form.useForm();
  const [emailForm] = Form.useForm();

  // SMTP / Email config state
  const [emailStatus, setEmailStatus] = useState(null); // null | "ok" | "error"
  const [emailStatusMsg, setEmailStatusMsg] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailTesting, setEmailTesting] = useState(false);
  const [smtpProvider, setSmtpProvider] = useState("smtp");
  const [emailMaintenanceActive, setEmailMaintenanceActive] = useState(false);
  const [driveStatus, setDriveStatus] = useState(null);
  const [driveStatusMsg, setDriveStatusMsg] = useState("");
  const [driveTestResult, setDriveTestResult] = useState(null);
  const [driveTesting, setDriveTesting] = useState(false);
  const [driveMaintenance, setDriveMaintenance] = useState(false);
  const [driveMaintenanceMsg, setDriveMaintenanceMsg] = useState("");
  const [driveSaving, setDriveSaving] = useState(false);
  const [driveConfig, setDriveConfig] = useState(null); // { ok, missing[], authMethod }
  const [driveVerified, setDriveVerified] = useState(false); // true after a real test-upload passes

  // Test-upload modal
  const [testUploadModal, setTestUploadModal] = useState({ open: false });
  const [testUploading, setTestUploading] = useState(false);
  const [testUploadResults, setTestUploadResults] = useState(null);
  const [testFileType, setTestFileType] = useState("text");
  const [testKeep, setTestKeep] = useState(false);

  // Collapsible left menu
  const [menuCollapsed, setMenuCollapsed] = useState(false);

  // Logs state
  const [logs, setLogs] = useState([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logLevel, setLogLevel] = useState("all");
  const [logSearch, setLogSearch] = useState("");
  const logFiltersRef = useRef({ level: "all", search: "" });

  // Deleted submissions state
  const [deletedEntries, setDeletedEntries] = useState([]);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [deletedSlfEntries, setDeletedSlfEntries] = useState([]);
  const [deletedSlfLoading, setDeletedSlfLoading] = useState(false);
  const [portalSecurityUsers, setPortalSecurityUsers] = useState([]);
  const [portalSecurityLoading, setPortalSecurityLoading] = useState(false);
  const [portalSecuritySearch, setPortalSecuritySearch] = useState("");
  const [portalSecurityModal, setPortalSecurityModal] = useState({ open: false, record: null });
  const [portalPasswordModal, setPortalPasswordModal] = useState({ open: false, record: null });
  const [portalWarningModal, setPortalWarningModal] = useState({ open: false, record: null });
  const [portalAccessModal, setPortalAccessModal] = useState({ open: false, record: null });
  const [portalAccessCellOptions, setPortalAccessCellOptions] = useState([]);
  const [portalAccessCellLoading, setPortalAccessCellLoading] = useState(false);
  const [portalSecuritySaving, setPortalSecuritySaving] = useState(false);
  const [portalSecurityForm] = Form.useForm();
  const [portalPasswordForm] = Form.useForm();
  const [portalWarningForm] = Form.useForm();
  const [portalAccessForm] = Form.useForm();
  const [submissionRecordModal, setSubmissionRecordModal] = useState({ open: false, user: null });
  const [submissionRecords, setSubmissionRecords] = useState([]);
  const [submissionRecordsLoading, setSubmissionRecordsLoading] = useState(false);

  // Dashboard display settings
  const DASHBOARD_TABS = [
    { key: "swm-plan", label: "10-Year SWM Plan", icon: <FundProjectionScreenOutlined /> },
    { key: "funded-mrf", label: "Funded MRF", icon: <BankOutlined /> },
    { key: "lgu-mrf", label: "LGU Initiated MRF", icon: <ApartmentOutlined /> },
    { key: "trash-traps", label: "Trash Traps", icon: <DeleteOutlined /> },
    { key: "swm-equip", label: "SWM Equipment", icon: <CarOutlined /> },
    { key: "slf-monitoring", label: "SLF Monitoring", icon: <BankOutlined /> },
    { key: "open-dumpsites", label: "Open Dumpsites", icon: <EnvironmentOutlined /> },
    { key: "residual-containment", label: "Residual Containment", icon: <SafetyCertificateOutlined /> },
    { key: "transfer-stations", label: "Transfer Stations", icon: <SwapOutlined /> },
    { key: "pds-scoping", label: "PDS (Scoping)", icon: <FileTextOutlined /> },
    { key: "tech-assist", label: "Technical Assistance", icon: <ToolOutlined /> },
    { key: "lgu-diversion", label: "LGU Assist & Diversion", icon: <TeamOutlined /> },
    { key: "data-history", label: "Data History", icon: <HistoryOutlined /> },
  ];
  const [dashboardTabs, setDashboardTabs] = useState({});
  const [dashSaving, setDashSaving] = useState(false);
  const historicalYearOptions = Array.from(
    { length: new Date().getFullYear() - 1999 },
    (_, i) => {
      const year = new Date().getFullYear() - i;
      return { label: String(year), value: year };
    }
  );

  useEffect(() => {
    if (typeof document !== "undefined" && !document.getElementById("portal-action-icon-styles")) {
      const style = document.createElement("style");
      style.id = "portal-action-icon-styles";
      style.innerHTML = `
        .portal-action-icons .ant-btn { transition: transform 0.18s ease, background 0.18s ease; }
        .portal-action-icons .ant-btn:hover { transform: translateY(-2px) scale(1.12); }
        @keyframes portalActionPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.18); }
        }
        .portal-action-icons .portal-action-active { animation: portalActionPulse 1.6s ease-in-out infinite; }
      `;
      document.head.appendChild(style);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchLogs({ showLoading: true });
    if (initialActiveKey === "portal-security") fetchPortalSecurityUsers();
    // Passive Google Drive configuration check (no network call to Drive) so a
    // readable warning can be shown when required env vars are missing.
    api
      .get("/settings/app/drive-status")
      .then(({ data }) => setDriveConfig(data))
      .catch(() => setDriveConfig(null));
    const logInterval = setInterval(() => fetchLogs({ showLoading: false }), 8000);
    return () => clearInterval(logInterval);
  }, []);

  const fetchSettings = async () => {
    try {
      const { data } = await api.get("/settings/app");
      setSettings(data);
      setAnnouncements(data.portalAnnouncements || []);
      form.setFieldsValue({
        ...data,
        portalAnnouncementType: data.portalAnnouncementType || "info",
        portalAnnouncementShowOnLogin:
          data.portalAnnouncementShowOnLogin !== false,
        portalAnnouncementShowInPortal:
          data.portalAnnouncementShowInPortal !== false,
        portalAnnouncementDismissible:
          data.portalAnnouncementDismissible !== false,
        portalAnnouncementStartAt: data.portalAnnouncementStartAt
          ? dayjs(data.portalAnnouncementStartAt)
          : null,
        portalAnnouncementEndAt: data.portalAnnouncementEndAt
          ? dayjs(data.portalAnnouncementEndAt)
          : null,
      });
      // Populate email form
      const provider = data.smtpProvider && data.smtpProvider !== "none"
        ? data.smtpProvider
        : data.smtpConfigured ? "smtp" : "gmail-apppw";  // default to Gmail since .env uses Gmail
      setSmtpProvider(provider);
      emailForm.setFieldsValue({
        smtpProvider:              provider,
        smtpHost:                  data.smtpHost  || (provider === "gmail-apppw" ? "smtp.gmail.com" : ""),
        smtpPort:                  data.smtpPort  || 587,
        smtpUser:                  data.smtpUser  || "",
        smtpPass:                  data.smtpPass  || "",
        smtpSecure:                data.smtpSecure || false,
        smtpFrom:                  data.smtpFrom  || "",
        emailNotificationsEnabled: data.emailNotificationsEnabled !== false,
        emailMaintenanceMode:      !!data.emailMaintenanceMode,
        emailMaintenanceMessage:   data.emailMaintenanceMessage || "Email notifications are temporarily disabled for maintenance.",
        sendTestTo:                "",
      });
      setEmailMaintenanceActive(!!data.emailMaintenanceMode);
      setDriveMaintenance(!!data.driveMaintenanceMode);
      setDriveMaintenanceMsg(data.driveMaintenanceMessage || "Google Drive is temporarily unavailable. File uploads are disabled.");
      // Parse dashboardTabs map
      if (data.dashboardTabs) {
        const parsed = typeof data.dashboardTabs === "object" ? data.dashboardTabs : {};
        setDashboardTabs(parsed);
      }
    } catch {
      Swal.fire("Error", "Could not load settings", "error");
    } finally {
      setLoading(false);
    }
  };

  const fetchAnnouncements = async () => {
    try {
      const { data } = await api.get("/settings/app/portal-announcements");
      setAnnouncements(data || []);
    } catch {
      /* silent */
    }
  };

  const fetchLogs = async (options = {}) => {
    const showLoading = options.showLoading !== false;
    const level = options.level ?? logFiltersRef.current.level;
    const search = options.search ?? logFiltersRef.current.search;
    logFiltersRef.current = { level, search };
    if (showLoading) setLogsLoading(true);
    try {
      const params = { limit: 100 };
      if (level !== "all") params.level = level;
      if (search) params.search = search;
      const { data } = await api.get("/logs", { params });
      setLogs(data.logs);
      setLogsTotal(data.total);
    } catch {
      /* silent */
    } finally {
      if (showLoading) setLogsLoading(false);
    }
  };

  const clearLogs = async () => {
    try {
      await api.delete("/logs");
      setLogs([]);
      setLogsTotal(0);
      Swal.fire({ icon: "success", title: "Logs cleared", timer: 800, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not clear logs", "error");
    }
  };

  // ── Deleted Submissions ──
  const fetchDeletedEntries = async () => {
    setDeletedLoading(true);
    try {
      const { data } = await api.get("/data-slf/trash/list");
      setDeletedEntries(data);
    } catch { /* silent */ }
    finally { setDeletedLoading(false); }
  };

  const restoreEntry = async (id) => {
    try {
      await api.patch(`/data-slf/${id}/restore`);
      setDeletedEntries((prev) => prev.filter((d) => d._id !== id));
      Swal.fire({ icon: "success", title: "Restored", text: "Submission restored successfully", timer: 1200, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not restore submission", "error");
    }
  };

  const permanentDelete = async (id) => {
    try {
      await api.delete(`/data-slf/${id}/permanent`);
      setDeletedEntries((prev) => prev.filter((d) => d._id !== id));
      Swal.fire({ icon: "success", title: "Permanently Deleted", timer: 1000, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not delete submission", "error");
    }
  };

  // ── Deleted SLF Data ──
  const fetchDeletedSlfEntries = async () => {
    setDeletedSlfLoading(true);
    try {
      const { data } = await api.get("/slf-facilities/trash/list");
      setDeletedSlfEntries(data);
    } catch {
      /* silent */
    } finally {
      setDeletedSlfLoading(false);
    }
  };

  const restoreSlfEntry = async (id) => {
    try {
      await api.patch(`/slf-facilities/${id}/restore`);
      setDeletedSlfEntries((prev) => prev.filter((d) => d._id !== id));
      Swal.fire({ icon: "success", title: "Restored", text: "SLF data restored successfully", timer: 1200, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not restore SLF data", "error");
    }
  };

  const permanentDeleteSlfEntry = async (id) => {
    try {
      await api.delete(`/slf-facilities/${id}/permanent`);
      setDeletedSlfEntries((prev) => prev.filter((d) => d._id !== id));
      Swal.fire({ icon: "success", title: "Permanently Deleted", timer: 1000, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not delete SLF data", "error");
    }
  };

  const fetchPortalSecurityUsers = async () => {
    setPortalSecurityLoading(true);
    try {
      const { data } = await api.get("/portal-users");
      setPortalSecurityUsers(Array.isArray(data) ? data : []);
    } catch {
      Swal.fire("Error", "Could not load portal users", "error");
    } finally {
      setPortalSecurityLoading(false);
    }
  };

  const openPortalSecurityModal = (record) => {
    setPortalSecurityModal({ open: true, record });
    portalSecurityForm.setFieldsValue({
      username: record.username || record.email?.split("@")?.[0] || "",
      email: record.email || "",
      blocked: !!record.blocked,
      blockedReason: record.blockedReason || "",
      maintenanceMode: !!record.maintenanceMode,
      maintenanceReason: record.maintenanceReason || "",
      verificationRequired: !!record.verificationRequired,
      allowCredentialSelfService: !!record.allowCredentialSelfService,
    });
  };

  const savePortalSecurity = async () => {
    setPortalSecuritySaving(true);
    try {
      const values = await portalSecurityForm.validateFields();
      const { data } = await api.patch(`/portal-users/${portalSecurityModal.record._id}/security`, values);
      setPortalSecurityUsers((prev) => prev.map((u) => u._id === data.data._id ? data.data : u));
      setPortalSecurityModal({ open: false, record: null });
      Swal.fire({ icon: "success", title: "Security settings saved", timer: 1100, showConfirmButton: false });
    } catch (err) {
      if (err?.errorFields) return;
      Swal.fire("Error", err.response?.data?.message || "Could not save security settings", "error");
    } finally {
      setPortalSecuritySaving(false);
    }
  };

  const resetPortalPassword = async () => {
    setPortalSecuritySaving(true);
    try {
      const values = await portalPasswordForm.validateFields();
      await api.patch(`/portal-users/${portalPasswordModal.record._id}/reset-password`, {
        password: values.password,
      });
      setPortalPasswordModal({ open: false, record: null });
      portalPasswordForm.resetFields();
      Swal.fire({ icon: "success", title: "Password reset", timer: 1100, showConfirmButton: false });
    } catch (err) {
      if (err?.errorFields) return;
      Swal.fire("Error", err.response?.data?.message || "Could not reset password", "error");
    } finally {
      setPortalSecuritySaving(false);
    }
  };

  const sendPortalWarning = async () => {
    setPortalSecuritySaving(true);
    try {
      const values = await portalWarningForm.validateFields();
      const { data } = await api.post(`/portal-users/${portalWarningModal.record._id}/security-warning`, values);
      setPortalSecurityUsers((prev) => prev.map((u) => u._id === data.data._id ? data.data : u));
      setPortalWarningModal({ open: false, record: null });
      portalWarningForm.resetFields();
      Swal.fire({ icon: "success", title: "Warning email sent", timer: 1100, showConfirmButton: false });
    } catch (err) {
      if (err?.errorFields) return;
      Swal.fire("Error", err.response?.data?.message || "Could not send warning email", "error");
    } finally {
      setPortalSecuritySaving(false);
    }
  };

  const togglePortalSecurityFlag = async (record, payload) => {
    try {
      const { data } = await api.patch(`/portal-users/${record._id}/security`, payload);
      setPortalSecurityUsers((prev) => prev.map((u) => u._id === data.data._id ? data.data : u));
      Swal.fire({ icon: "success", title: "Account updated", timer: 900, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not update account", "error");
    }
  };

  // ── Manage Access (per-user feature toggles + allowed disposal cells) ──
  const loadPortalAccessCellOptions = async (record) => {
    const ids = Array.isArray(record?.assignedSlf) ? record.assignedSlf : [];
    const names = Array.isArray(record?.assignedSlfName) ? record.assignedSlfName : [];
    if (!ids.length) {
      setPortalAccessCellOptions([]);
      return;
    }
    setPortalAccessCellLoading(true);
    try {
      const results = await Promise.all(
        ids.map((id, idx) => {
          const sid = typeof id === "object" ? id?._id || id?.$oid || id : id;
          const nameParam = names[idx] ? `?slfName=${encodeURIComponent(names[idx])}` : "";
          return api
            .get(`/slf-facilities/portal/${sid}${nameParam}`)
            .then(({ data }) => ({ data, name: names[idx] || data?.lgu || "SLF" }))
            .catch(() => null);
        }),
      );
      const options = [];
      const seen = new Set();
      results.filter(Boolean).forEach(({ data, name }) => {
        const count = Number(data?.numberOfCell || data?.cellStatuses?.length || 0);
        for (let i = 0; i < count; i++) {
          const status = String(data?.cellStatuses?.[i] || "");
          const isOpen = ["Active Cell", "Operational", "Active"].includes(status);
          const submissionAllowed = data?.cellSubmissionAllowed?.[i] !== false;
          if (!isOpen || !submissionAllowed) continue;
          const value = `Cell ${i + 1}`;
          if (seen.has(value)) return;
          seen.add(value);
          const type = data?.cellTypes?.[i] ? ` - ${data.cellTypes[i]}` : "";
          options.push({ label: `${value}${type} (${name})`, value });
        }
      });
      setPortalAccessCellOptions(options);
    } finally {
      setPortalAccessCellLoading(false);
    }
  };

  const openPortalAccessModal = (record) => {
    const access = record.portalAccess || {};
    setPortalAccessModal({ open: true, record });
    portalAccessForm.setFieldsValue({
      canSubmitDisposal: access.canSubmitDisposal !== false,
      canEditBaseline: access.canEditBaseline !== false,
      canUploadExcel: access.canUploadExcel !== false,
      allowedCells: Array.isArray(access.allowedCells) ? access.allowedCells : [],
    });
    setPortalAccessCellOptions([]);
    loadPortalAccessCellOptions(record);
  };

  const savePortalAccess = async () => {
    setPortalSecuritySaving(true);
    try {
      const values = await portalAccessForm.validateFields();
      const { data } = await api.patch(
        `/portal-users/${portalAccessModal.record._id}/access`,
        values,
      );
      setPortalSecurityUsers((prev) => prev.map((u) => (u._id === data.data._id ? data.data : u)));
      setPortalAccessModal({ open: false, record: null });
      Swal.fire({ icon: "success", title: "Access updated", timer: 1100, showConfirmButton: false });
    } catch (err) {
      if (err?.errorFields) return;
      Swal.fire("Error", err.response?.data?.message || "Could not update access", "error");
    } finally {
      setPortalSecuritySaving(false);
    }
  };

  // ── View Submission Record (CRUD of a portal user's raw submissions) ──
  const fetchSubmissionRecords = useCallback(async (user) => {
    if (!user?._id) return;
    setSubmissionRecordsLoading(true);
    try {
      const { data } = await api.get(`/portal-users/${user._id}/submission-history`);
      setSubmissionRecords(Array.isArray(data?.submissions) ? data.submissions : []);
    } catch {
      Swal.fire("Error", "Could not load submission records", "error");
    } finally {
      setSubmissionRecordsLoading(false);
    }
  }, []);

  const openSubmissionRecordModal = (user) => {
    setSubmissionRecordModal({ open: true, user });
    setSubmissionRecords([]);
    fetchSubmissionRecords(user);
  };

  const handleSubmissionRecordEdit = async (record) => {
    const { value: formValues } = await Swal.fire({
      title: `Edit ${record.idNo || "Submission"}`,
      html:
        `<input id="swal-company" class="swal2-input" placeholder="Company / LGU name" value="${(record.lguCompanyName || "").replace(/"/g, "&quot;")}">` +
        `<select id="swal-type" class="swal2-input">` +
        `<option value="LGU" ${record.companyType === "LGU" ? "selected" : ""}>LGU</option>` +
        `<option value="Private" ${record.companyType === "Private" ? "selected" : ""}>Private</option>` +
        `</select>`,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: "Save Changes",
      confirmButtonColor: "#2f54eb",
      preConfirm: () => ({
        lguCompanyName: document.getElementById("swal-company").value.trim(),
        companyType: document.getElementById("swal-type").value,
      }),
    });
    if (!formValues) return;
    try {
      const { data } = await api.patch(`/data-slf/${record._id}/admin-edit`, {
        ...formValues,
        updatedBy: "Developer Settings",
      });
      setSubmissionRecords((prev) =>
        prev.map((r) => (r._id === record._id ? { ...r, ...data } : r)),
      );
      Swal.fire({ icon: "success", title: "Submission updated", timer: 1100, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not update submission", "error");
    }
  };

  const handleSubmissionRecordStatus = async (record, status) => {
    try {
      await api.patch(`/data-slf/${record._id}/status`, { status });
      setSubmissionRecords((prev) =>
        prev.map((r) => (r._id === record._id ? { ...r, status } : r)),
      );
      Swal.fire({ icon: "success", title: `Marked ${status}`, timer: 900, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not update status", "error");
    }
  };

  const handleSubmissionRecordDelete = async (record) => {
    const confirm = await Swal.fire({
      title: `Delete ${record.idNo || "submission"}?`,
      text: "This moves the submission to Deleted Submissions (soft delete).",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      confirmButtonColor: "#ff4d4f",
    });
    if (!confirm.isConfirmed) return;
    try {
      await api.delete(`/data-slf/${record._id}`);
      setSubmissionRecords((prev) => prev.filter((r) => r._id !== record._id));
      Swal.fire({ icon: "success", title: "Deleted", timer: 800, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not delete submission", "error");
    }
  };

  const filteredPortalSecurityUsers = portalSecurityUsers.filter((user) => {
    const q = portalSecuritySearch.trim().toLowerCase();
    if (!q) return true;
    return [
      user.firstName,
      user.lastName,
      user.username,
      user.email,
      user.companyName,
      Array.isArray(user.assignedSlfName) ? user.assignedSlfName.join(" ") : user.assignedSlfName,
    ].some((value) => String(value || "").toLowerCase().includes(q));
  });

  const writeClientLog = (action) => {
    fetchLogs({ showLoading: true });
  };

  // ── SMTP / Email config handlers ──────────────────────────────────────────
  const handleEmailSave = async (values) => {
    setEmailSaving(true);
    try {
      await api.put("/settings/app/email-config", {
        ...values,
        smtpConfigured: values.smtpProvider !== "none",
        emailMaintenanceMode: !!values.emailMaintenanceMode,
        emailMaintenanceMessage: values.emailMaintenanceMessage || "",
      });
      setEmailMaintenanceActive(!!values.emailMaintenanceMode);
      setEmailStatus(null);
      setEmailStatusMsg("");
      Swal.fire({ icon: "success", title: "Email config saved", text: "Settings applied immediately — no restart required.", timer: 2200, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not save email config", "error");
    } finally {
      setEmailSaving(false);
    }
  };

  const handleEmailTest = async () => {
    setEmailTesting(true);
    setEmailStatus(null);
    setEmailStatusMsg("");
    try {
      const values = emailForm.getFieldsValue();
      const { data } = await api.post("/settings/app/email-test", {
        smtpProvider: values.smtpProvider,
        smtpHost:     values.smtpHost,
        smtpPort:     values.smtpPort,
        smtpUser:     values.smtpUser,
        smtpPass:     values.smtpPass,
        smtpSecure:   values.smtpSecure,
        sendTestTo:   values.sendTestTo || "",
      });
      setEmailStatus("ok");
      setEmailStatusMsg(data.message);
    } catch (err) {
      setEmailStatus("error");
      setEmailStatusMsg(err.response?.data?.message || "Connection test failed");
    } finally {
      setEmailTesting(false);
    }
  };

  const handleDriveSave = async () => {
    setDriveSaving(true);
    try {
      await api.put("/settings/app/drive-config", {
        driveMaintenanceMode: driveMaintenance,
        driveMaintenanceMessage: driveMaintenanceMsg,
      });
      Swal.fire({
        icon: "success",
        title: driveMaintenance ? "Drive Maintenance Mode Enabled" : "Drive Maintenance Mode Disabled",
        text: driveMaintenance
          ? "All file uploads are now blocked. Data entry and Excel imports are unaffected."
          : "Drive access is restored. File uploads are now allowed.",
        timer: 2500,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not save Drive config", "error");
    } finally {
      setDriveSaving(false);
    }
  };

  const handleDriveTest = async () => {
    setDriveTesting(true);
    setDriveStatus(null);
    setDriveStatusMsg("");
    setDriveTestResult(null);
    try {
      const { data } = await api.post("/settings/app/drive-test");
      setDriveStatus("ok");
      setDriveStatusMsg(data.message || "Google Drive connection verified.");
      setDriveTestResult(data.data || null);
    } catch (err) {
      setDriveStatus("error");
      setDriveStatusMsg(err.response?.data?.message || "Google Drive test failed");
      setDriveVerified(false);
    } finally {
      setDriveTesting(false);
    }
  };

  const handleTestUpload = async () => {
    setTestUploading(true);
    setTestUploadResults(null);
    try {
      const { data } = await api.post("/settings/app/drive-test-upload", {
        fileType: testFileType,
        keep: testKeep,
      });
      setTestUploadResults(data);
      if (data.ok) setDriveVerified(true);
    } catch (err) {
      setTestUploadResults({
        ok: false,
        message: err.response?.data?.message || "Test upload failed",
        results: [],
      });
      setDriveVerified(false);
    } finally {
      setTestUploading(false);
    }
  };

  const moveToDummy = async (user) => {
    try {
      await api.patch(`/dummy-data/portal-users/${user._id}/mark`, { isDummy: true });
      setPortalSecurityUsers((prev) => prev.filter((u) => u._id !== user._id));
      Swal.fire({
        icon: "success",
        title: "Moved to Dummy Data",
        text: `${user.firstName} ${user.lastName} has been moved to Dummy Data Configuration.`,
        timer: 1800,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not move user", "error");
    }
  };

  // ── Dashboard Tab Visibility ──
  const handleDashTabChange = (tabKey, field, value) => {
    setDashboardTabs(prev => ({
      ...prev,
      [tabKey]: { ...(prev[tabKey] || { visible: true, maintenance: false, maintenanceMessage: "" }), [field]: value },
    }));
  };

  const saveDashboardTabs = async () => {
    setDashSaving(true);
    try {
      await api.put("/settings/app", { dashboardTabs });
      Swal.fire({ icon: "success", title: "Dashboard settings saved", timer: 1000, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not save dashboard settings", "error");
    } finally {
      setDashSaving(false);
    }
  };

  const handleSave = async (values) => {
    setSaving(true);
    try {
      const payload = {
        ...values,
        portalAnnouncementStartAt:
          values.portalAnnouncementStartAt?.toISOString?.() || null,
        portalAnnouncementEndAt:
          values.portalAnnouncementEndAt?.toISOString?.() || null,
      };
      const { data } = await api.put("/settings/app", payload);
      setSettings(data.data);
      form.setFieldsValue({
        ...data.data,
        portalAnnouncementType: data.data.portalAnnouncementType || "info",
        portalAnnouncementShowOnLogin:
          data.data.portalAnnouncementShowOnLogin !== false,
        portalAnnouncementShowInPortal:
          data.data.portalAnnouncementShowInPortal !== false,
        portalAnnouncementDismissible:
          data.data.portalAnnouncementDismissible !== false,
        portalAnnouncementStartAt: data.data.portalAnnouncementStartAt
          ? dayjs(data.data.portalAnnouncementStartAt)
          : null,
        portalAnnouncementEndAt: data.data.portalAnnouncementEndAt
          ? dayjs(data.data.portalAnnouncementEndAt)
          : null,
      });
      if (onSettingsSaved) onSettingsSaved(data.data);
      // Invalidate ALL data caches so every page re-fetches fresh data
      // with the updated year-visibility settings applied.
      secureStorage.invalidateAllDataCaches();
      writeClientLog("settings.update");      Swal.fire({
        icon: "success",
        title: "Settings Saved",
        timer: 1200,
        showConfirmButton: false,
      });
    } catch {
      Swal.fire("Error", "Could not save settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const openAnnouncementModal = (record = null) => {
    setAnnouncementModal({ open: true, record });
    announcementForm.setFieldsValue({
      enabled: record?.enabled || false,
      type: record?.type || "info",
      title: record?.title || "",
      message: record?.message || "",
      startAt: record?.startAt ? dayjs(record.startAt) : null,
      endAt: record?.endAt ? dayjs(record.endAt) : null,
      showOnLogin: record?.showOnLogin !== false,
      showInPortal: record?.showInPortal !== false,
      dismissible: record?.dismissible !== false,
    });
  };

  const saveAnnouncement = async () => {
    setAnnouncementSaving(true);
    try {
      const values = await announcementForm.validateFields();
      const payload = {
        ...values,
        startAt: values.startAt?.toISOString?.() || null,
        endAt: values.endAt?.toISOString?.() || null,
      };
      const id = announcementModal.record?._id;
      const { data } = id
        ? await api.put(`/settings/app/portal-announcements/${id}`, payload)
        : await api.post("/settings/app/portal-announcements", payload);
      setSettings(data.settings || settings);
      if (onSettingsSaved && data.settings) onSettingsSaved(data.settings);
      await fetchAnnouncements();
      setAnnouncementModal({ open: false, record: null });
      Swal.fire({ icon: "success", title: id ? "Announcement Updated" : "Announcement Created", timer: 1100, showConfirmButton: false });
    } catch (err) {
      if (err?.errorFields) return;
      Swal.fire("Error", err.response?.data?.message || "Could not save announcement", "error");
    } finally {
      setAnnouncementSaving(false);
    }
  };

  const deleteAnnouncement = async (record) => {
    try {
      await api.delete(`/settings/app/portal-announcements/${record._id}`);
      await fetchSettings();
      Swal.fire({ icon: "success", title: "Announcement Deleted", timer: 1000, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not delete announcement", "error");
    }
  };

  const sendAnnouncementEmail = async (record) => {
    setAnnouncementEmailSending(true);
    try {
      const { data } = await api.post("/settings/app/portal-announcement/email", {
        announcementId: record._id,
        title: record.title,
        message: record.message,
        subject: record.title,
        emailMessage: record.message,
      });
      await fetchSettings();
      Swal.fire({
        icon: data.failed ? "warning" : "success",
        title: "Announcement Email Sent",
        text: `${data.sent || 0} sent${data.failed ? `, ${data.failed} failed` : ""}.`,
        timer: 2200,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire(
        "Error",
        err.response?.data?.message || "Could not send announcement email",
        "error",
      );
    } finally {
      setAnnouncementEmailSending(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <style>
        {`
          .developer-settings-tabs .ant-tabs-tab {
            font-size: 11px;
            padding: 5px 8px;
            margin: 1px 0 !important;
            line-height: 1.25;
          }
          .developer-settings-tabs .ant-tabs-tab + .ant-tabs-tab {
            margin-top: 2px !important;
          }
          .developer-settings-tabs .ant-tabs-tab .anticon {
            font-size: 12px;
            margin-right: 6px;
          }
          .developer-settings-tabs .ant-tabs-tab-btn {
            font-weight: 500;
          }
          /* Collapsed left menu: keep icons, hide label text */
          .developer-settings-tabs.dev-collapsed .ant-tabs-tab-btn {
            font-size: 0 !important;
          }
          .developer-settings-tabs.dev-collapsed .ant-tabs-tab .anticon {
            font-size: 16px !important;
            margin-right: 0 !important;
          }
          .developer-settings-tabs.dev-collapsed .ant-tabs-tab {
            justify-content: center;
            padding: 8px 0 !important;
          }
          @media (max-width: 576px) {
            .developer-settings-tabs .ant-tabs-nav { width: 100% !important; }
          }
        `}
      </style>
      <Tabs
        defaultActiveKey={initialActiveKey}
        size="small"
        tabPosition="left"
        className={`developer-settings-tabs${menuCollapsed ? " dev-collapsed" : ""}`}
        style={{
          marginTop: 8,
          minHeight: 620,
          background: isDark ? "#141414" : "#fff",
          border: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
          borderRadius: 10,
          padding: 12,
        }}
        tabBarStyle={{
          width: menuCollapsed ? 52 : 210,
          fontSize: 11,
          paddingRight: menuCollapsed ? 0 : 8,
          transition: "width 0.2s ease",
          borderRight: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
        }}
        tabBarExtraContent={{
          left: (
            <div style={{ padding: "4px 4px 8px", textAlign: "center" }}>
              <Tooltip title={menuCollapsed ? "Expand menu" : "Collapse menu"} placement="right">
                <Button
                  size="small"
                  type="text"
                  icon={menuCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                  onClick={() => setMenuCollapsed((v) => !v)}
                  style={{ width: menuCollapsed ? 36 : "100%", fontSize: 12 }}
                />
              </Tooltip>
            </div>
          ),
        }}
        onChange={(key) => {
          if (key === "portal-security" && portalSecurityUsers.length === 0) fetchPortalSecurityUsers();
          if (key === "deleted-submissions" && deletedEntries.length === 0) fetchDeletedEntries();
          if (key === "deleted-slf-data" && deletedSlfEntries.length === 0) fetchDeletedSlfEntries();
        }}
        items={[
          {
            key: "general",
            label: <span><GlobalOutlined /> General</span>,
            children: (
              <Form form={form} layout="vertical" onFinish={handleSave} initialValues={settings}>
                {/* General Settings */}
                <Card
                  style={{ marginTop: 0, borderRadius: 10 }}
                  title={
                    <Space>
                      <GlobalOutlined style={{ color: "#4096ff" }} />
                      <Text strong>General Settings</Text>
                    </Space>
                  }
                >
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="appName" label="Application Name">
                        <Input placeholder="EMBR3 ESWMP" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="appDescription" label="Application Description">
                        <Input placeholder="Ecological Solid Waste Management Pipeline" />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                {/* Theme & Appearance */}
                <Card
                  style={{ marginTop: 16, borderRadius: 10 }}
                  title={
                    <Space>
                      <BgColorsOutlined style={{ color: "#4096ff" }} />
                      <Text strong>Theme &amp; Appearance</Text>
                    </Space>
                  }
                >
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={8}>
                      <Form.Item name="theme" label="Admin Theme">
                        <Select>
                          <Option value="light">Light Mode</Option>
                          <Option value="dark">Dark Mode</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="primaryColor" label="Primary Color">
                        <Input type="color" style={{ width: 80, height: 36, padding: 2, cursor: "pointer" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="sidebarStyle" label="Sidebar Style">
                        <Select>
                          <Option value="gradient">Gradient</Option>
                          <Option value="solid">Solid</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                  </Row>

                  <Divider titlePlacement="left" style={{ fontSize: 13 }}>Sider</Divider>
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={8}>
                      <Form.Item name="siderColor" label="Sider Color (Light)">
                        <Input type="color" style={{ width: 80, height: 36, padding: 2, cursor: "pointer" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="siderColorDark" label="Sider Color (Dark)">
                        <Input type="color" style={{ width: 80, height: 36, padding: 2, cursor: "pointer" }} />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Divider titlePlacement="left" style={{ fontSize: 13 }}>Header</Divider>
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={8}>
                      <Form.Item name="headerColor" label="Header Color (Light)">
                        <Input type="color" style={{ width: 80, height: 36, padding: 2, cursor: "pointer" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="headerColorDark" label="Header Color (Dark)">
                        <Input type="color" style={{ width: 80, height: 36, padding: 2, cursor: "pointer" }} />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                <Card
                  style={{ marginTop: 16, borderRadius: 10 }}
                  title={
                    <Space>
                      <HistoryOutlined style={{ color: "#fa8c16" }} />
                      <Text strong>Historical Data Visibility</Text>
                    </Space>
                  }
                >
                  <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                    Hide records on the whole system using either a cutoff year, specific years, or both.
                    Hidden records are excluded from dashboards, lists, and portal views across the entire app.
                    Clear all values to make all records visible again.
                  </Text>
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="hideHistoricalRecordsEnabled" label="Hide Historical Records" valuePropName="checked">
                        <Switch checkedChildren="On" unCheckedChildren="Off" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="hideRecordsBeforeOrEqualYear" label="Hide records for year <=">
                        <InputNumber min={1900} max={3000} style={{ width: "100%" }} placeholder="e.g. 2025" />
                      </Form.Item>
                    </Col>
                    <Col xs={24}>
                      <Form.Item name="hiddenRecordYears" label="Hide specific years (multiple)">
                        <Select
                          mode="multiple"
                          allowClear
                          placeholder="Select year(s) to hide, e.g. 2022, 2024"
                          options={historicalYearOptions}
                          optionFilterProp="label"
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                <Card
                  style={{ marginTop: 16, borderRadius: 10 }}
                  title={
                    <Space>
                      <DatabaseOutlined style={{ color: "#52c41a" }} />
                      <Text strong>Baseline & Submission Volume Analysis</Text>
                    </Space>
                  }
                >
                  <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                    Control how portal submission volumes are counted against SLF cells when baseline data was encoded after earlier disposal dates.
                  </Text>
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="excludePreBaselineDisposalFromCellFill" label="Exclude pre-baseline disposal from cell fill" valuePropName="checked">
                        <Switch checkedChildren="On" unCheckedChildren="Off" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="preBaselineDisposalDetectorEnabled" label="Enable detector badges" valuePropName="checked">
                        <Switch checkedChildren="On" unCheckedChildren="Off" />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                <div style={{ marginTop: 24, textAlign: "right" }}>
                  <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />} size="large"
                    style={{ borderRadius: 8, fontWeight: 600, paddingLeft: 32, paddingRight: 32 }}>
                    Save Settings
                  </Button>
                </div>
              </Form>
            ),
          },
          {
            key: "portal-email",
            label: <span><MailOutlined /> Portal &amp; Email</span>,
            children: (
              <>
              <Form form={form} layout="vertical" onFinish={handleSave} initialValues={settings}>
                {/* Portal Settings */}
                <Card
                  style={{ marginTop: 0, borderRadius: 10 }}
                  title={
                    <Space>
                      <SettingOutlined style={{ color: "#4096ff" }} />
                      <Text strong>Portal Settings</Text>
                    </Space>
                  }
                >
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="portalTitle" label="Portal Title">
                        <Input placeholder="SLF Generators Portal" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="portalEnabled" label="Portal Enabled" valuePropName="checked">
                        <Switch checkedChildren="On" unCheckedChildren="Off" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={[16, 0]}>
                    <Col xs={24}>
                      <Form.Item name="portalSubtitle" label="Portal Subtitle">
                        <TextArea rows={2} placeholder="Portal subtitle text" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="requireEmailOnSubmit" label="Require Email on Submit" valuePropName="checked">
                        <Switch checkedChildren="Yes" unCheckedChildren="No" />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                {/* Portal Maintenance */}
                <Card
                  style={{ marginTop: 16, borderRadius: 10 }}
                  title={
                    <Space>
                      <ToolOutlined style={{ color: "#fa8c16" }} />
                      <Text strong>Portal Maintenance</Text>
                    </Space>
                  }
                >
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="portalMaintenanceMode" label="Maintenance Mode" valuePropName="checked">
                        <Switch checkedChildren="On" unCheckedChildren="Off" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="portalMaintenanceReason" label="Maintenance Reason">
                        <Select placeholder="Select reason" allowClear options={[
                          { label: "Scheduled Maintenance", value: "scheduled" },
                          { label: "Emergency Maintenance", value: "emergency" },
                          { label: "System Upgrade", value: "upgrade" },
                          { label: "Database Migration", value: "migration" },
                          { label: "Security Update", value: "security" },
                          { label: "Other", value: "other" },
                        ]} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={[16, 0]}>
                    <Col xs={24}>
                      <Form.Item name="portalMaintenanceMessage" label="Maintenance Message">
                        <TextArea rows={2} placeholder="The portal is currently under maintenance. Please try again later." />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                {/* Email Settings */}
                <Card
                  style={{ marginTop: 16, borderRadius: 10 }}
                  title={
                    <Space>
                      <MailOutlined style={{ color: "#4096ff" }} />
                      <Text strong>Email Settings</Text>
                    </Space>
                  }
                >
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="emailNotificationsEnabled" label="Email Notifications" valuePropName="checked">
                        <Switch checkedChildren="Enabled" unCheckedChildren="Disabled" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="emailFrom" label="From Email Address">
                        <Input placeholder="noreply@yourdomain.com" />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                <div style={{ marginTop: 24, textAlign: "right" }}>
                  <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />} size="large"
                    style={{ borderRadius: 8, fontWeight: 600, paddingLeft: 32, paddingRight: 32 }}>
                    Save Settings
                  </Button>
                </div>
              </Form>

              {/* ── SMTP / Email Transport Configuration ── */}
              <Form form={emailForm} layout="vertical" onFinish={handleEmailSave} style={{ marginTop: 24 }}>
                <Card
                  style={{ borderRadius: 10 }}
                  title={
                    <Space>
                      <ApiOutlined style={{ color: "#fa8c16" }} />
                      <Text strong>Email / SMTP Transport</Text>
                      {emailStatus === "ok" && <Tag color="success" icon={<CheckCircleOutlined />}>Connected</Tag>}
                      {emailStatus === "error" && <Tag color="error" icon={<CloseCircleOutlined />}>Failed</Tag>}
                    </Space>
                  }
                >
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16, borderRadius: 8 }}
                    message="Configure the mail transport used for portal emails."
                    description={
                      <span>
                        Your <code>.env</code> is configured with a Gmail account (<code>embreswmp@gmail.com</code>).
                        Gmail requires either an <strong>App Password</strong> (needs 2FA enabled) or
                        <strong> OAuth2</strong> (needs the OAuth client re-enabled in Cloud Console).
                        Alternatively, switch to <strong>Generic SMTP</strong> with any other provider.
                        All changes are saved to the database — no server restart needed.
                      </span>
                    }
                  />
                  {emailMaintenanceActive && (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 16, borderRadius: 8 }}
                      message="Email Maintenance Mode is ACTIVE"
                      description="All email sends are currently silently skipped. Portal registrations, approvals, acknowledgements, and reset-password emails will NOT be delivered until maintenance mode is turned OFF and settings are saved."
                      action={
                        <Button
                          size="small"
                          danger
                          onClick={() => {
                            emailForm.setFieldsValue({ emailMaintenanceMode: false });
                            setEmailMaintenanceActive(false);
                          }}
                        >
                          Turn Off
                        </Button>
                      }
                    />
                  )}

                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="smtpProvider" label="Mail Provider">
                        <Select
                          onChange={(v) => {
                            if (v === "gmail-apppw") {
                              emailForm.setFieldsValue({ smtpHost: "smtp.gmail.com", smtpPort: 587, smtpSecure: false });
                              setSmtpProvider("gmail-apppw");
                            } else if (v === "gmail-oauth2") {
                              setSmtpProvider("gmail-oauth2");
                            } else if (v === "smtp") {
                              setSmtpProvider("smtp");
                            } else if (v === "outlook") {
                              emailForm.setFieldsValue({ smtpHost: "smtp.office365.com", smtpPort: 587, smtpSecure: false, smtpProvider: "smtp" });
                              setSmtpProvider("smtp");
                            } else if (v === "yahoo") {
                              emailForm.setFieldsValue({ smtpHost: "smtp.mail.yahoo.com", smtpPort: 587, smtpSecure: false, smtpProvider: "smtp" });
                              setSmtpProvider("smtp");
                            } else {
                              setSmtpProvider(v);
                            }
                          }}
                          options={[
                            { label: "Gmail — App Password", value: "gmail-apppw" },
                            { label: "Gmail — OAuth2", value: "gmail-oauth2" },
                            { label: "Generic SMTP (any provider)", value: "smtp" },
                            { label: "—— Quick presets ——", value: "divider", disabled: true },
                            { label: "Outlook / Hotmail (smtp.office365.com)", value: "outlook" },
                            { label: "Yahoo Mail (smtp.mail.yahoo.com)", value: "yahoo" },
                            { label: "None (disable email)", value: "none" },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={6}>
                      <Form.Item name="emailNotificationsEnabled" label="Email Notifications" valuePropName="checked">
                        <Switch checkedChildren="Enabled" unCheckedChildren="Disabled" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={6}>
                      <Form.Item
                        name="emailMaintenanceMode"
                        label={<span style={{ color: "#cf1322" }}>Maintenance Mode</span>}
                        valuePropName="checked"
                        tooltip="When ON, all email sends are silently skipped. No emails go out until this is turned off."
                      >
                        <Switch
                          checkedChildren="ON"
                          unCheckedChildren="OFF"
                          style={{ backgroundColor: emailForm.getFieldValue?.("emailMaintenanceMode") ? "#cf1322" : undefined }}
                        />
                      </Form.Item>
                    </Col>
                  </Row>

                  {smtpProvider !== "none" && smtpProvider !== "gmail-oauth2" && (
                    <>
                      <Row gutter={[16, 0]}>
                        <Col xs={24} md={14}>
                          <Form.Item
                            name="smtpHost"
                            label="SMTP Host"
                            rules={[{ required: smtpProvider !== "none", message: "Enter SMTP host" }]}
                          >
                            <Input placeholder="smtp.gmail.com" prefix={<ApiOutlined />} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={6}>
                          <Form.Item name="smtpPort" label="Port" rules={[{ required: true }]}>
                            <InputNumber min={1} max={65535} style={{ width: "100%" }} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item name="smtpSecure" label="SSL (port 465)" valuePropName="checked">
                            <Switch checkedChildren="SSL" unCheckedChildren="TLS" />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Row gutter={[16, 0]}>
                        <Col xs={24} md={12}>
                          <Form.Item
                            name="smtpUser"
                            label="Username / Email"
                            rules={[{ required: smtpProvider !== "none", message: "Enter username" }]}
                          >
                            <Input placeholder="embreswmp@gmail.com" prefix={<MailOutlined />} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                          <Form.Item
                            name="smtpPass"
                            label="Password / App Password"
                            rules={[{ required: false }]}
                          >
                            <Input.Password placeholder="Leave as-is to keep existing password" />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Row gutter={[16, 0]}>
                        <Col xs={24} md={12}>
                          <Form.Item name="smtpFrom" label="From Address (optional)">
                            <Input placeholder="EMBR3 ESWMP <embreswmp@gmail.com>" prefix={<MailOutlined />} />
                          </Form.Item>
                        </Col>
                      </Row>
                    </>
                  )}

                  <Form.Item
                    noStyle
                    shouldUpdate={(prev, cur) => prev.emailMaintenanceMode !== cur.emailMaintenanceMode}
                  >
                    {({ getFieldValue }) => getFieldValue("emailMaintenanceMode") && (
                      <Form.Item
                        name="emailMaintenanceMessage"
                        label="Maintenance Message"
                        tooltip="Shown in server logs when a send is skipped. Not user-facing."
                      >
                        <Input.TextArea rows={2} placeholder="Email notifications are temporarily disabled for maintenance." />
                      </Form.Item>
                    )}
                  </Form.Item>

                  {smtpProvider === "gmail-oauth2" && (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 12, borderRadius: 8 }}
                      message="Gmail OAuth2 requires the OAuth client to be enabled in Google Cloud Console."
                      description={
                        <span>
                          1. Re-enable the client at <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">console.cloud.google.com/apis/credentials</a><br />
                          2. Run <code>node utils/generateGmailToken.js</code> from the server directory.<br />
                          3. Set the resulting <code>GMAIL_REFRESH_TOKEN</code> in <code>server/.env</code>.
                        </span>
                      }
                    />
                  )}

                  {emailStatusMsg && (
                    <Alert
                      type={emailStatus === "ok" ? "success" : "error"}
                      showIcon
                      style={{ marginBottom: 12, borderRadius: 8 }}
                      message={emailStatusMsg}
                    />
                  )}

                  {/* Test Email row */}
                  <Row gutter={[12, 0]} align="bottom" style={{ marginTop: 8 }}>
                    <Col xs={24} md={14}>
                      <Form.Item name="sendTestTo" label="Send Test Email To (optional)">
                        <Input placeholder="admin@example.com" prefix={<SendOutlined />} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={10}>
                      <Form.Item label=" ">
                        <Space wrap>
                          <Button
                            icon={<ApiOutlined />}
                            onClick={handleEmailTest}
                            loading={emailTesting}
                            disabled={smtpProvider === "none" || smtpProvider === "gmail-oauth2"}
                          >
                            Test Connection
                          </Button>
                          <Button
                            type="primary"
                            htmlType="submit"
                            loading={emailSaving}
                            icon={<SaveOutlined />}
                          >
                            Save Email Config
                          </Button>
                        </Space>
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              </Form>

              <Card
                style={{ marginTop: 16, borderRadius: 10 }}
                title={
                  <Space>
                    <DatabaseOutlined style={{ color: "#13a8a8" }} />
                    <Text strong>Google Drive Access</Text>
                    {driveMaintenance
                      ? <Tag color="error">Maintenance ON — Uploads Blocked</Tag>
                      : driveStatus === "ok" ? <Tag color="success" icon={<CheckCircleOutlined />}>Connected</Tag>
                      : driveStatus === "error" ? <Tag color="error" icon={<CloseCircleOutlined />}>Failed</Tag>
                      : null}
                  </Space>
                }
              >
                {driveMaintenance && (
                  <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 16, borderRadius: 8 }}
                    message="Drive Maintenance Mode is ACTIVE"
                    description="All file uploads (documents, images, hauler LOI) are blocked. Data entry and Excel imports continue to work normally. Turn this off once your Drive account is restored."
                  />
                )}

                {driveConfig && !driveConfig.ok && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16, borderRadius: 8 }}
                    message="Google Drive configuration is incomplete"
                    description={
                      <div>
                        <div>Uploads will fall back to local storage until these environment variables are set in <code>server/.env</code>:</div>
                        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                          {(driveConfig.missing || []).map((m) => (
                            <li key={m}><code>{m}</code></li>
                          ))}
                        </ul>
                      </div>
                    }
                  />
                )}
                {driveVerified && (
                  <Alert
                    type="success"
                    showIcon
                    icon={<CheckCircleOutlined />}
                    style={{ marginBottom: 16, borderRadius: 8 }}
                    message="Google Drive is connected and all folders are writable."
                  />
                )}

                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16, borderRadius: 8 }}
                  message="Enable maintenance mode while Google Drive credentials are unavailable."
                  description="When ON, all upload endpoints return 503. All existing files remain accessible (read-only). The Excel/CSV data import in the portal is unaffected."
                />

                <Row gutter={[16, 12]} align="middle" style={{ marginBottom: 12 }}>
                  <Col xs={24} md={8}>
                    <Space direction="vertical" size={2}>
                      <Text strong>Drive Maintenance Mode</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>Blocks all Drive-based file uploads</Text>
                    </Space>
                  </Col>
                  <Col xs={24} md={4}>
                    <Switch
                      checked={driveMaintenance}
                      onChange={setDriveMaintenance}
                      checkedChildren="ON"
                      unCheckedChildren="OFF"
                      style={{ backgroundColor: driveMaintenance ? "#cf1322" : undefined }}
                    />
                  </Col>
                </Row>

                {driveMaintenance && (
                  <div style={{ marginBottom: 12 }}>
                    <Text style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Message shown when upload is blocked</Text>
                    <Input.TextArea
                      rows={2}
                      value={driveMaintenanceMsg}
                      onChange={(e) => setDriveMaintenanceMsg(e.target.value)}
                      placeholder="Google Drive is temporarily unavailable. File uploads are disabled."
                    />
                  </div>
                )}

                {driveStatusMsg && (
                  <Alert
                    type={driveStatus === "ok" ? "success" : "error"}
                    showIcon
                    style={{ marginBottom: 12, borderRadius: 8 }}
                    message={driveStatusMsg}
                  />
                )}

                {driveTestResult?.folders?.length > 0 && (
                  <Descriptions bordered size="small" column={1} style={{ marginBottom: 12 }}>
                    <Descriptions.Item label="Auth Client">
                      {driveTestResult.client}
                    </Descriptions.Item>
                    {driveTestResult.folders.map((folder) => (
                      <Descriptions.Item key={folder.key} label={folder.key}>
                        <Space direction="vertical" size={0}>
                          <Text strong>{folder.name}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>{folder.id}</Text>
                          <Tag color={folder.writable ? "success" : "warning"} style={{ width: "fit-content" }}>
                            {folder.writable ? "Writable" : "Read-only"}
                          </Tag>
                        </Space>
                      </Descriptions.Item>
                    ))}
                  </Descriptions>
                )}

                <Space wrap>
                  <Button
                    icon={<DatabaseOutlined />}
                    onClick={handleDriveTest}
                    loading={driveTesting}
                    disabled={driveMaintenance}
                  >
                    Test Drive Access
                  </Button>
                  {isDeveloper && (
                    <Button
                      icon={<UploadOutlined />}
                      onClick={() => { setTestUploadResults(null); setTestUploadModal({ open: true }); }}
                      disabled={driveMaintenance}
                    >
                      Test Upload
                    </Button>
                  )}
                  <Button
                    type="primary"
                    danger={driveMaintenance}
                    icon={<SaveOutlined />}
                    loading={driveSaving}
                    onClick={handleDriveSave}
                  >
                    {driveMaintenance ? "Save & Block Uploads" : "Save Drive Config"}
                  </Button>
                </Space>
              </Card>
              </>
            ),
          },
          {
            key: "announcements",
            label: <span><NotificationOutlined /> Announcements</span>,
            children: (
              <Card
                style={{ borderRadius: 10 }}
                title={<Space><NotificationOutlined style={{ color: "#52c41a" }} /><Text strong>Announcement Manager</Text></Space>}
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openAnnouncementModal()}>New Announcement</Button>}
              >
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16, borderRadius: 8 }}
                  message="Manage posted announcements for SLF portal users."
                  description="Only one announcement can be published at a time. Published announcements appear on the selected portal surfaces."
                />
                <ResponsiveTable
                  dataSource={announcements}
                  rowKey="_id"
                  size="small"
                  pagination={{ pageSize: 8, pageSizeOptions: ["8", "15", "30"], showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}` }}
                  locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No announcements yet" /> }}
                  columns={[
                    {
                      title: "Announcement",
                      key: "announcement",
                      width: 360,
                      render: (_, record) => (
                        <Space direction="vertical" size={2}>
                          <Space wrap>
                            <Text strong>{record.title || "Untitled"}</Text>
                            {record.enabled && <Tag color="green">Published</Tag>}
                            <Tag color={record.type === "error" ? "red" : record.type === "warning" ? "orange" : record.type === "success" ? "green" : "blue"}>{record.type || "info"}</Tag>
                          </Space>
                          <Text type="secondary" style={{ fontSize: 12, whiteSpace: "normal", overflowWrap: "anywhere" }}>{record.message || "No message"}</Text>
                        </Space>
                      ),
                    },
                    {
                      title: "Placement",
                      key: "placement",
                      width: 170,
                      render: (_, record) => (
                        <Space size={[4, 4]} wrap>
                          {record.showOnLogin !== false && <Tag color="blue">Login</Tag>}
                          {record.showInPortal !== false && <Tag color="cyan">Portal</Tag>}
                          {record.dismissible !== false && <Tag>Dismissible</Tag>}
                        </Space>
                      ),
                    },
                    {
                      title: "Validity",
                      key: "validity",
                      width: 220,
                      render: (_, record) => (
                        <Space direction="vertical" size={0}>
                          <Text style={{ fontSize: 12 }}>From: {record.startAt ? dayjs(record.startAt).format("MM/DD/YYYY h:mm A") : "Always"}</Text>
                          <Text style={{ fontSize: 12 }}>Until: {record.endAt ? dayjs(record.endAt).format("MM/DD/YYYY h:mm A") : "No end"}</Text>
                        </Space>
                      ),
                    },
                    {
                      title: "Actions",
                      key: "actions",
                      width: 190,
                      fixed: "right",
                      render: (_, record) => (
                        <Space size={4}>
                          <Tooltip title="Edit">
                            <Button size="small" icon={<EditOutlined />} onClick={() => openAnnouncementModal(record)} />
                          </Tooltip>
                          <Popconfirm title="Email announcement?" description="This will email all approved SLF portal users." okText="Send" onConfirm={() => sendAnnouncementEmail(record)}>
                            <Tooltip title="Send to Portal Users">
                              <Button size="small" type="primary" icon={<SendOutlined />} loading={announcementEmailSending} />
                            </Tooltip>
                          </Popconfirm>
                          <Popconfirm title="Delete announcement?" okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => deleteAnnouncement(record)}>
                            <Tooltip title="Delete">
                              <Button size="small" danger icon={<DeleteOutlined />} />
                            </Tooltip>
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: "security",
            label: <span><LockOutlined /> Security</span>,
            children: (
              <Form form={form} layout="vertical" onFinish={handleSave} initialValues={settings}>
                {/* Security Settings */}
                <Card
                  style={{ marginTop: 0, borderRadius: 10 }}
                  title={
                    <Space>
                      <LockOutlined style={{ color: "#4096ff" }} />
                      <Text strong>Security Settings</Text>
                    </Space>
                  }
                >
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={8}>
                      <Form.Item name="sessionTimeout" label="Session Timeout (days)">
                        <InputNumber min={1} max={30} style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="maxLoginAttempts" label="Max Login Attempts">
                        <InputNumber min={1} max={20} style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="defaultRole" label="Default Role for New Users">
                        <Select>
                          <Option value="admin">Admin</Option>
                          <Option value="user">User</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="allowSignup" label="Allow Public Signup" valuePropName="checked">
                        <Switch checkedChildren="Yes" unCheckedChildren="No" />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                {/* Maintenance */}
                <Card
                  style={{ marginTop: 16, borderRadius: 10 }}
                  title={
                    <Space>
                      <DatabaseOutlined style={{ color: "#4096ff" }} />
                      <Text strong>Maintenance</Text>
                    </Space>
                  }
                >
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="maintenanceMode" label="Maintenance Mode" valuePropName="checked">
                        <Switch checkedChildren="On" unCheckedChildren="Off" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={[16, 0]}>
                    <Col xs={24}>
                      <Form.Item name="maintenanceMessage" label="Maintenance Message">
                        <TextArea rows={2} placeholder="System is under maintenance..." />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                <div style={{ marginTop: 24, textAlign: "right" }}>
                  <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />} size="large"
                    style={{ borderRadius: 8, fontWeight: 600, paddingLeft: 32, paddingRight: 32 }}>
                    Save Settings
                  </Button>
                </div>
              </Form>
            ),
          },
          {
            key: "portal-security",
            label: <span><SafetyCertificateOutlined /> Portal Users Security</span>,
            children: (
              <Card
                style={{ borderRadius: 10 }}
                title={
                  <Space>
                    <SafetyCertificateOutlined style={{ color: "#4096ff" }} />
                    <Text strong>Portal Users Security Settings</Text>
                    <Tag>{filteredPortalSecurityUsers.length}</Tag>
                  </Space>
                }
                extra={
                  <Space wrap>
                    <Input
                      size="small"
                      allowClear
                      prefix={<SearchOutlined />}
                      placeholder="Search portal users"
                      value={portalSecuritySearch}
                      onChange={(e) => setPortalSecuritySearch(e.target.value)}
                      style={{ width: 220 }}
                    />
                    <Button size="small" icon={<ReloadOutlined />} onClick={fetchPortalSecurityUsers} loading={portalSecurityLoading}>
                      Refresh
                    </Button>
                  </Space>
                }
              >
                {/* <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12, borderRadius: 8 }}
                  message="Security controls here affect portal access immediately."
                  description="Use these settings for username/email changes, password resets, account blocking, account maintenance, hold/re-verification, warning emails, and portal-user security review."
                />
                <Alert
                  type="success"
                  showIcon
                  style={{ marginBottom: 12, borderRadius: 8 }}
                  message="Credential update permission is now managed per portal user."
                  description="Enable the credential switch only for users who are allowed to update their own username and password after email-code verification."
                /> */}
                <ResponsiveTable
                  dataSource={filteredPortalSecurityUsers}
                  rowKey="_id"
                  loading={portalSecurityLoading}
                  pagination={{ pageSize: 15, size: "small" }}
                  scroll={{ x: 1120 }}
                  columns={[
                    {
                      title: "Portal User",
                      key: "user",
                      width: 240,
                      render: (_, user) => (
                        <Space direction="vertical" size={0}>
                          <Text strong style={{ fontSize: 12 }}>{`${user.firstName || ""} ${user.lastName || ""}`.trim() || "Portal User"}</Text>
                          <Text style={{ fontSize: 11, whiteSpace: "normal", wordBreak: "break-word" }}>@{user.username || user.email?.split("@")?.[0] || "username"}</Text>
                          <Text type="secondary" style={{ fontSize: 11, whiteSpace: "normal", wordBreak: "break-word" }}>{user.email}</Text>
                        </Space>
                      ),
                    },
                    {
                      title: "Company / SLF",
                      key: "company",
                      width: 260,
                      render: (_, user) => (
                        <Space direction="vertical" size={0}>
                          <Text style={{ fontSize: 12 }}>{user.companyName || "—"}</Text>
                          <Text type="secondary" style={{ fontSize: 11, whiteSpace: "normal", wordBreak: "break-word" }}>
                            {Array.isArray(user.assignedSlfName) ? user.assignedSlfName.join(", ") : user.assignedSlfName || "No SLF assigned"}
                          </Text>
                        </Space>
                      ),
                    },
                    {
                      title: "Account State",
                      key: "state",
                      width: 230,
                      render: (_, user) => (
                        <Space size={[4, 4]} wrap>
                          <Tag color={user.status === "approved" ? "green" : user.status === "pending" ? "gold" : "red"}>{user.status || "pending"}</Tag>
                          {user.verificationRequired && <Tag color="orange">Hold</Tag>}
                          {user.blocked && <Tag color="red">Blocked</Tag>}
                          {user.maintenanceMode && <Tag color="blue">Maintenance</Tag>}
                        </Space>
                      ),
                    },
                    {
                      title: "Warnings",
                      key: "warnings",
                      width: 150,
                      render: (_, user) => (
                        <Space direction="vertical" size={0}>
                          <Text style={{ fontSize: 12 }}>{Number(user.securityWarningCount || 0)} sent</Text>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {user.lastSecurityWarningAt ? dayjs(user.lastSecurityWarningAt).format("MM/DD/YYYY h:mm A") : "No warning email"}
                          </Text>
                        </Space>
                      ),
                    },
                    {
                      title: "Credential Updates",
                      key: "credentialUpdates",
                      width: 170,
                      render: (_, user) => (
                        <Switch
                          size="small"
                          checked={!!user.allowCredentialSelfService}
                          checkedChildren="Allowed"
                          unCheckedChildren="Blocked"
                          onChange={(checked) =>
                            togglePortalSecurityFlag(user, { allowCredentialSelfService: checked })
                          }
                        />
                      ),
                    },
                    {
                      title: "Actions",
                      key: "actions",
                      width: 230,
                      fixed: "right",
                      render: (_, user) => (
                        <Space size={4} wrap className="portal-action-icons">
                          <Tooltip title="View submission records (CRUD)">
                            <Button
                              size="small"
                              type="text"
                              icon={<ContainerOutlined />}
                              style={{ color: "#13c2c2" }}
                              onClick={() => openSubmissionRecordModal(user)}
                            />
                          </Tooltip>
                          <Tooltip title="Manage access (disposal cells & portal features)">
                            <Button
                              size="small"
                              type="text"
                              icon={<ApartmentOutlined />}
                              style={{ color: "#722ed1" }}
                              onClick={() => openPortalAccessModal(user)}
                            />
                          </Tooltip>
                          <Tooltip title="Edit security settings">
                            <Button size="small" type="text" icon={<EditOutlined />} style={{ color: "#2f54eb" }} onClick={() => openPortalSecurityModal(user)} />
                          </Tooltip>
                          <Tooltip title="Reset password">
                            <Button size="small" type="text" icon={<LockOutlined />} style={{ color: "#fa8c16" }} onClick={() => {
                              setPortalPasswordModal({ open: true, record: user });
                              portalPasswordForm.resetFields();
                            }} />
                          </Tooltip>
                          <Tooltip title="Send warning email">
                            <Button
                              size="small"
                              type="text"
                              icon={<MailOutlined />}
                              style={{ color: user.securityWarningCount > 0 ? "#d4380d" : "#8c8c8c" }}
                              onClick={() => {
                                setPortalWarningModal({ open: true, record: user });
                                portalWarningForm.setFieldsValue({
                                  subject: "Portal Account Security Notice",
                                  message: `Hello ${user.firstName || "Portal User"},\n\nPlease review your SLF portal account activity and comply with the required portal account security measures.\n\nThank you.`,
                                });
                              }}
                            />
                          </Tooltip>
                          <Tooltip title={user.blocked ? "Unblock account" : "Block account"}>
                            <Button
                              size="small"
                              type="text"
                              icon={user.blocked ? <UnlockOutlined /> : <LockOutlined />}
                              className={user.blocked ? "portal-action-active" : ""}
                              style={{ color: user.blocked ? "#cf1322" : "#8c8c8c" }}
                              onClick={() => togglePortalSecurityFlag(user, {
                                blocked: !user.blocked,
                                blockedReason: !user.blocked ? "Blocked by admin security settings" : "",
                              })}
                            />
                          </Tooltip>
                          <Tooltip title={user.maintenanceMode ? "End maintenance" : "Hold for maintenance"}>
                            <Button
                              size="small"
                              type="text"
                              icon={<ToolOutlined />}
                              className={user.maintenanceMode ? "portal-action-active" : ""}
                              style={{ color: user.maintenanceMode ? "#1677ff" : "#8c8c8c" }}
                              onClick={() => togglePortalSecurityFlag(user, {
                                maintenanceMode: !user.maintenanceMode,
                                maintenanceReason: !user.maintenanceMode ? "Account under maintenance by admin" : "",
                              })}
                            />
                          </Tooltip>
                          <Tooltip title="Move to Dummy Data (removes from Portal Users list)">
                            <Popconfirm
                              title="Move to Dummy Data?"
                              description={`${user.firstName} ${user.lastName} will no longer appear in Portal Users. You can manage them in Dummy Data Configuration.`}
                              onConfirm={() => moveToDummy(user)}
                              okText="Move"
                              okButtonProps={{ style: { background: "#722ed1", borderColor: "#722ed1" } }}
                            >
                              <Button
                                size="small"
                                type="text"
                                icon={<ExperimentOutlined />}
                                style={{ color: "#722ed1" }}
                              />
                            </Popconfirm>
                          </Tooltip>
                        </Space>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: "system",
            label: <span><ToolOutlined /> System &amp; Logs</span>,
            children: (
              <>
                {/* System Info (read-only) */}
                <Card
                  style={{ marginTop: 0, borderRadius: 10 }}
                  title={
                    <Space>
                      <ToolOutlined style={{ color: "#4096ff" }} />
                      <Text strong>System Info</Text>
                    </Space>
                  }
                >
                  <Descriptions column={{ xs: 1, sm: 2 }} size="small">
                    <Descriptions.Item label="Version">
                      <Tag color="blue">1.0.0</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="Environment">
                      <Tag color="green">Production</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="Last Updated">
                      {settings?.updatedAt
                        ? new Date(settings.updatedAt).toLocaleString()
                        : "\u2014"}
                    </Descriptions.Item>
                    <Descriptions.Item label="Settings ID">
                      <Text copyable type="secondary" style={{ fontSize: 12 }}>
                        {settings?._id || "\u2014"}
                      </Text>
                    </Descriptions.Item>
                  </Descriptions>
                </Card>

                {/* App Logs */}
                <Card
                  style={{ marginTop: 16, borderRadius: 10 }}
                  title={
                    <Space>
                      <FileTextOutlined style={{ color: "#4096ff" }} />
                      <Text strong>App Logs</Text>
                      <Badge count={logsTotal} overflowCount={999} style={{ marginLeft: 4 }} />
                    </Space>
                  }
                  extra={
                    <Space wrap>
                      <Select
                        value={logLevel}
                        onChange={(v) => {
                          setLogLevel(v);
                          fetchLogs({ level: v, search: logSearch, showLoading: true });
                        }}
                        style={{ width: "100%", minWidth: 90, maxWidth: 110 }}
                        size="small"
                      >
                        <Option value="all">All Levels</Option>
                        <Option value="info">Info</Option>
                        <Option value="warn">Warning</Option>
                        <Option value="error">Error</Option>
                      </Select>
                      <Input
                        placeholder="Search logs..."
                        value={logSearch}
                        onChange={(e) => {
                          setLogSearch(e.target.value);
                          logFiltersRef.current = { ...logFiltersRef.current, search: e.target.value };
                        }}
                        onPressEnter={() => fetchLogs({ showLoading: true })}
                        style={{ width: "100%", maxWidth: 180 }}
                        size="small"
                        allowClear
                      />
                      <Button size="small" icon={<ReloadOutlined />} onClick={() => fetchLogs({ showLoading: true })}>
                        Refresh
                      </Button>
                      <Popconfirm title="Clear all logs?" onConfirm={clearLogs}>
                        <Button size="small" danger icon={<DeleteOutlined />}>
                          Clear
                        </Button>
                      </Popconfirm>
                    </Space>
                  }
                >
                  <ResponsiveTable
                    dataSource={logs}
                    rowKey="_id"
                    size="small"
                    loading={logsLoading}
                    pagination={{ pageSize: 30, size: "small" }}
                    scroll={{ x: 950 }}
                    style={{ fontSize: 11 }}
                    className="compact-logs-table"
                    columns={[
                      {
                        title: "Time",
                        dataIndex: "createdAt",
                        key: "createdAt",
                        width: 130,
                        render: (v) => (
                          <Text style={{ fontSize: 10, whiteSpace: "nowrap" }}>
                            {dayjs(v).format("MMM DD, HH:mm:ss")}
                          </Text>
                        ),
                      },
                      {
                        title: "Level",
                        dataIndex: "level",
                        key: "level",
                        width: 65,
                        render: (v) => {
                          const colors = { info: "blue", warn: "orange", error: "red" };
                          return <Tag color={colors[v] || "default"} style={{ fontSize: 10, padding: "0 4px", lineHeight: "18px" }}>{v?.toUpperCase()}</Tag>;
                        },
                      },
                      {
                        title: "Action",
                        dataIndex: "action",
                        key: "action",
                        width: 180,
                        render: (v) => <Tag style={{ fontSize: 10, padding: "0 4px", lineHeight: "18px" }}>{v}</Tag>,
                      },
                      {
                        title: "Message",
                        dataIndex: "message",
                        key: "message",
                        ellipsis: true,
                        render: (v) => <Text style={{ fontSize: 11 }}>{v}</Text>,
                      },
                      {
                        title: "User",
                        dataIndex: "user",
                        key: "user",
                        width: 220,
                        ellipsis: true,
                        render: (v) => <Text style={{ fontSize: 10 }}>{v || "—"}</Text>,
                      },
                      {
                        title: "IP",
                        dataIndex: "ip",
                        key: "ip",
                        width: 150,
                        render: (v) => <Text style={{ fontSize: 10 }}>{v || "—"}</Text>,
                      },
                      {
                        title: "Location",
                        key: "location",
                        width: 200,
                        render: (_, log) => {
                          const geo = log.geo || {};
                          const label = geo.label || "—";
                          const isPrivate = geo.source === "private";
                          const isBrowser = geo.source === "browser";
                          const color = isBrowser ? "green" : isPrivate ? "default" : "blue";
                          const icon = isBrowser ? <AimOutlined /> : <EnvironmentOutlined />;
                          return (
                            <Tooltip
                              title={
                                geo.lat != null && geo.lng != null
                                  ? `${Number(geo.lat).toFixed(4)}, ${Number(geo.lng).toFixed(4)}${isBrowser ? " (shared by user)" : ""}`
                                  : label
                              }
                            >
                              <Tag color={color} icon={icon} style={{ fontSize: 10, maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis" }}>
                                {label}
                              </Tag>
                            </Tooltip>
                          );
                        },
                      },
                    ]}
                  />
                </Card>
              </>
            ),
          },          {
            key: "deleted-submissions",
            label: <span><DeleteOutlined /> Deleted Submissions</span>,
            children: (
              <Card
                style={{ borderRadius: 10 }}
                title={
                  <Space>
                    <DeleteOutlined style={{ color: "#ff4d4f" }} />
                    <span>Deleted Submissions</span>
                    <Tag>{deletedEntries.length}</Tag>
                  </Space>
                }
                extra={
                  <Button icon={<ReloadOutlined />} size="small" onClick={fetchDeletedEntries} loading={deletedLoading}>
                    Refresh
                  </Button>
                }
              >
                {deletedEntries.length === 0 && !deletedLoading ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: isDark ? "#666" : "#999" }}>
                    <DeleteOutlined style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }} />
                    <div>No deleted submissions</div>
                    <Button type="link" size="small" onClick={fetchDeletedEntries} style={{ marginTop: 8 }}>Load deleted submissions</Button>
                  </div>
                ) : (
                  <ResponsiveTable
                    dataSource={deletedEntries}
                    rowKey="_id"
                    size="small"
                    loading={deletedLoading}
                    pagination={{ pageSize: 15, size: "small" }}
                    scroll={{ x: 900 }}
                    columns={[
                      { title: "ID No.", dataIndex: "idNo", key: "idNo", width: 160, render: (v) => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
                      { title: "LGU/Company", dataIndex: "lguCompanyName", key: "company", ellipsis: true, width: 200 },
                      { title: "Type", dataIndex: "companyType", key: "type", width: 80, render: (v) => <Tag color={v === "LGU" ? "blue" : "purple"} bordered={false}>{v}</Tag> },
                      { title: "Status (before delete)", dataIndex: "status", key: "status", width: 140, render: (v) => <Tag color={v === "pending" ? "orange" : v === "acknowledged" ? "green" : v === "rejected" ? "red" : v === "reverted" ? "volcano" : "default"}>{v?.charAt(0).toUpperCase() + v?.slice(1)}</Tag> },
                      { title: "Deleted At", dataIndex: "deletedAt", key: "deletedAt", width: 160, render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v ? dayjs(v).format("MM/DD/YYYY hh:mm A") : "—"}</Text> },
                      { title: "Deleted By", dataIndex: "deletedBy", key: "deletedBy", width: 120, render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v || "—"}</Text> },
                      {
                        title: "Actions", key: "actions", width: 200,
                        render: (_, r) => (
                          <Space size={4}>
                            <Tooltip title="Restore submission">
                              <Button size="small" icon={<UndoOutlined />} style={{ borderColor: "#52c41a", color: "#52c41a" }} onClick={() => restoreEntry(r._id)}>
                                Restore
                              </Button>
                            </Tooltip>
                            <Popconfirm
                              title="Permanently delete?"
                              description="This cannot be undone."
                              onConfirm={() => permanentDelete(r._id)}
                              okText="Delete Forever"
                              okButtonProps={{ danger: true }}
                            >
                              <Tooltip title="Delete forever">
                                <Button size="small" danger icon={<DeleteOutlined />}>Delete</Button>
                              </Tooltip>
                            </Popconfirm>
                          </Space>
                        ),
                      },
                    ]}
                  />
                )}
              </Card>
            ),
          },          {
            key: "dashboard-display",
            label: <span><DashboardOutlined /> Dashboard Display</span>,
            children: (
              <Card
                style={{ borderRadius: 10 }}
                title={<Space><DashboardOutlined style={{ color: "#4096ff" }} /><Text strong>Dashboard Tab Visibility & Maintenance</Text></Space>}
                extra={<Button type="primary" icon={<SaveOutlined />} loading={dashSaving} onClick={saveDashboardTabs}>Save Dashboard Settings</Button>}
              >
                <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
                  Control which dashboard tabs are shown and set individual tabs to maintenance mode. Changes are reflected immediately on the Dashboard menu.
                </Text>
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {DASHBOARD_TABS.map((tab, idx) => {
                    const cfg = dashboardTabs[tab.key] || { visible: true, maintenance: false, maintenanceMessage: "" };
                    const isVisible = cfg.visible !== false;
                    const isMaint = cfg.maintenance === true;
                    return (
                      <div key={tab.key} style={{
                        padding: "12px 16px",
                        borderBottom: idx < DASHBOARD_TABS.length - 1 ? (isDark ? "1px solid #303030" : "1px solid #f0f0f0") : "none",
                        background: !isVisible ? (isDark ? "#1f1f1f" : "#fafafa") : isMaint ? (isDark ? "rgba(250,219,20,0.1)" : "#fffbe6") : "transparent",
                        borderRadius: 6,
                        opacity: isVisible ? 1 : 0.6,
                      }}>
                        <Row align="middle" gutter={16}>
                          <Col flex="auto">
                            <Space>
                              <span style={{ fontSize: 16 }}>{tab.icon}</span>
                              <Text strong style={{ fontSize: 14 }}>{tab.label}</Text>
                              {!isVisible && <Tag color="default">Hidden</Tag>}
                              {isMaint && <Tag color="warning">Maintenance</Tag>}
                            </Space>
                          </Col>
                          <Col>
                            <Space size="middle">
                              <Tooltip title={isVisible ? "Click to hide" : "Click to show"}>
                                <Switch
                                  checked={isVisible}
                                  onChange={v => handleDashTabChange(tab.key, "visible", v)}
                                  checkedChildren={<EyeOutlined />}
                                  unCheckedChildren={<EyeInvisibleOutlined />}
                                />
                              </Tooltip>
                              <Tooltip title="Maintenance mode">
                                <Switch
                                  checked={isMaint}
                                  onChange={v => handleDashTabChange(tab.key, "maintenance", v)}
                                  checkedChildren={<ToolOutlined />}
                                  unCheckedChildren={<ToolOutlined />}
                                  disabled={!isVisible}
                                  style={isMaint ? { background: "#faad14" } : {}}
                                />
                              </Tooltip>
                            </Space>
                          </Col>
                        </Row>
                        {isMaint && isVisible && (
                          <div style={{ marginTop: 8, paddingLeft: 32 }}>
                            <Input
                              size="small"
                              placeholder="Maintenance message (optional)"
                              value={cfg.maintenanceMessage || ""}
                              onChange={e => handleDashTabChange(tab.key, "maintenanceMessage", e.target.value)}
                              style={{ maxWidth: 500 }}
                              prefix={<ExclamationCircleOutlined style={{ color: "#faad14" }} />}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Divider />
                <Row gutter={16}>
                  <Col>
                    <Button size="small" onClick={() => {
                      const all = {};
                      DASHBOARD_TABS.forEach(t => { all[t.key] = { ...(dashboardTabs[t.key] || {}), visible: true }; });
                      setDashboardTabs(all);
                    }}>Show All</Button>
                  </Col>
                  <Col>
                    <Button size="small" onClick={() => {
                      const all = {};
                      DASHBOARD_TABS.forEach(t => { all[t.key] = { ...(dashboardTabs[t.key] || {}), visible: false }; });
                      setDashboardTabs(all);
                    }}>Hide All</Button>
                  </Col>
                  <Col>
                    <Button size="small" danger onClick={() => {
                      const all = {};
                      DASHBOARD_TABS.forEach(t => { all[t.key] = { ...(dashboardTabs[t.key] || {}), maintenance: false, maintenanceMessage: "" }; });
                      setDashboardTabs(all);
                    }}>Disable All Maintenance</Button>
                  </Col>
                </Row>
              </Card>
            ),
          },
          {
            key: "deleted-slf-data",
            label: <span><DatabaseOutlined /> Deleted SLF Data</span>,
            children: (
              <Card
                style={{ borderRadius: 10 }}
                title={
                  <Space>
                    <DeleteOutlined style={{ color: "#ff4d4f" }} />
                    <span>Deleted SLF Data</span>
                    <Tag>{deletedSlfEntries.length}</Tag>
                  </Space>
                }
                extra={
                  <Button icon={<ReloadOutlined />} size="small" onClick={fetchDeletedSlfEntries} loading={deletedSlfLoading}>
                    Refresh
                  </Button>
                }
              >
                {deletedSlfEntries.length === 0 && !deletedSlfLoading ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: isDark ? "#666" : "#999" }}>
                    <DeleteOutlined style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }} />
                    <div>No deleted SLF data</div>
                    <Button type="link" size="small" onClick={fetchDeletedSlfEntries} style={{ marginTop: 8 }}>Load deleted SLF data</Button>
                  </div>
                ) : (
                  <ResponsiveTable
                    dataSource={deletedSlfEntries}
                    rowKey="_id"
                    size="small"
                    loading={deletedSlfLoading}
                    pagination={{ pageSize: 15, size: "small" }}
                    scroll={{ x: 900 }}
                    columns={[
                      { title: "Data Year", dataIndex: "dataYear", key: "dataYear", width: 90, render: (v) => <Tag color="blue">{v || "—"}</Tag> },
                      { title: "Province", dataIndex: "province", key: "province", width: 160 },
                      { title: "LGU", dataIndex: "lgu", key: "lgu", width: 180, ellipsis: true, render: (v) => <Text strong>{v || "—"}</Text> },
                      { title: "Category", dataIndex: "category", key: "category", width: 120, render: (v) => v ? <Tag>{v}</Tag> : "—" },
                      { title: "Status", dataIndex: "statusOfSLF", key: "statusOfSLF", width: 150, render: (v) => <Tag color={/operational/i.test(v || "") && !/non/i.test(v || "") ? "green" : /non/i.test(v || "") ? "red" : "default"}>{v || "—"}</Tag> },
                      { title: "Deleted At", dataIndex: "deletedAt", key: "deletedAt", width: 170, render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v ? dayjs(v).format("MM/DD/YYYY hh:mm A") : "—"}</Text> },
                      { title: "Deleted By", dataIndex: "deletedBy", key: "deletedBy", width: 120, render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v || "—"}</Text> },
                      {
                        title: "Actions", key: "actions", width: 200,
                        render: (_, r) => (
                          <Space size={4}>
                            <Tooltip title="Restore SLF data">
                              <Button size="small" icon={<UndoOutlined />} style={{ borderColor: "#52c41a", color: "#52c41a" }} onClick={() => restoreSlfEntry(r._id)}>
                                Restore
                              </Button>
                            </Tooltip>
                            <Popconfirm
                              title="Permanently delete?"
                              description="This cannot be undone."
                              onConfirm={() => permanentDeleteSlfEntry(r._id)}
                              okText="Delete Forever"
                              okButtonProps={{ danger: true }}
                            >
                              <Tooltip title="Delete forever">
                                <Button size="small" danger icon={<DeleteOutlined />}>Delete</Button>
                              </Tooltip>
                            </Popconfirm>
                          </Space>
                        ),
                      },
                    ]}
                  />
                )}
              </Card>
            ),
          },
          ...(isDeveloper
            ? [
                {
                  key: "dummy-data",
                  label: <span><ExperimentOutlined /> Dummy Data Config</span>,
                  children: <DummyDataConfig isDark={isDark} />,
                },
              ]
            : []),
          {
            key: "slf-data-files",
            label: <span><FolderOpenOutlined /> SLF Data Table Files</span>,
            children: <SLFDataTableFiles isDark={isDark} />,
          },
          // {
          //   key: "accounts",
          //   label: <span><TeamOutlined /> Accounts &amp; Roles</span>,
          //   children: <AccountSettings isDark={isDark} />,
          // },
        ]}
      />
      <Modal
        title="Portal User Security"
        open={portalSecurityModal.open}
        onCancel={() => setPortalSecurityModal({ open: false, record: null })}
        onOk={savePortalSecurity}
        confirmLoading={portalSecuritySaving}
        okText="Save Security Settings"
        width={720}
        destroyOnHidden
      >
        <Form form={portalSecurityForm} layout="vertical">
          <Form.Item
            name="username"
            label="Username"
            rules={[{ required: true, message: "Username is required" }]}
          >
            <Input prefix={<UserOutlined />} />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: "Email is required" },
              { type: "email", message: "Enter a valid email" },
            ]}
          >
            <Input prefix={<MailOutlined />} />
          </Form.Item>
          <Row gutter={[16, 0]}>
            <Col xs={24} md={6}>
              <Form.Item name="blocked" label="Block Account" valuePropName="checked">
                <Switch checkedChildren="Blocked" unCheckedChildren="Open" />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="maintenanceMode" label="Maintenance" valuePropName="checked">
                <Switch checkedChildren="On" unCheckedChildren="Off" />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="verificationRequired" label="Hold / Re-verify" valuePropName="checked">
                <Switch checkedChildren="Hold" unCheckedChildren="Clear" />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="allowCredentialSelfService" label="Credential Updates" valuePropName="checked">
                <Switch checkedChildren="Allow" unCheckedChildren="Block" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="blockedReason" label="Blocking Reason">
            <TextArea rows={2} placeholder="Reason shown to the portal user when blocked" />
          </Form.Item>
          <Form.Item name="maintenanceReason" label="Maintenance Note">
            <TextArea rows={2} placeholder="Reason shown to the portal user during account maintenance" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={
          <Space>
            <ApartmentOutlined style={{ color: "#722ed1" }} />
            <span>
              Manage Access
              {portalAccessModal.record ? ` — ${`${portalAccessModal.record.firstName || ""} ${portalAccessModal.record.lastName || ""}`.trim() || portalAccessModal.record.email}` : ""}
            </span>
          </Space>
        }
        open={portalAccessModal.open}
        onCancel={() => setPortalAccessModal({ open: false, record: null })}
        onOk={savePortalAccess}
        confirmLoading={portalSecuritySaving}
        okText="Save Access"
        okButtonProps={{ icon: <SaveOutlined /> }}
        width={640}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16, borderRadius: 8 }}
          message="Control what this portal user can do"
          description="Disable a feature to remove it from the SLF portal for this user. Restrict disposal cells to limit which open cells they can submit volume waste into. Leave cells empty to allow all admin-opened cells."
        />
        <Form form={portalAccessForm} layout="vertical">
          <Row gutter={[16, 0]}>
            <Col xs={24} md={8}>
              <Form.Item name="canSubmitDisposal" label="Submit Disposal Entries" valuePropName="checked">
                <Switch checkedChildren="Allowed" unCheckedChildren="Blocked" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="canEditBaseline" label="Edit Baseline Data" valuePropName="checked">
                <Switch checkedChildren="Allowed" unCheckedChildren="Blocked" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="canUploadExcel" label="Upload Excel Files" valuePropName="checked">
                <Switch checkedChildren="Allowed" unCheckedChildren="Blocked" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="allowedCells"
            label={
              <Space size={4}>
                <ContainerOutlined style={{ color: "#722ed1" }} />
                <span>Allowed Disposal Cells</span>
              </Space>
            }
            tooltip="Only open cells configured on the SLF Data Table (Cell Infrastructure) appear here. Empty = all open cells allowed."
          >
            <Select
              mode="tags"
              allowClear
              loading={portalAccessCellLoading}
              placeholder={
                portalAccessCellLoading
                  ? "Loading open cells..."
                  : portalAccessCellOptions.length
                    ? "Select open cells (empty = all allowed)"
                    : "No open cells configured — leave empty to allow all"
              }
              options={portalAccessCellOptions}
              tokenSeparators={[","]}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={
          <Space>
            <ContainerOutlined style={{ color: "#13c2c2" }} />
            <span>
              Submission Records
              {submissionRecordModal.user
                ? ` — ${`${submissionRecordModal.user.firstName || ""} ${submissionRecordModal.user.lastName || ""}`.trim() || submissionRecordModal.user.email}`
                : ""}
            </span>
          </Space>
        }
        open={submissionRecordModal.open}
        onCancel={() => setSubmissionRecordModal({ open: false, user: null })}
        footer={
          <Button onClick={() => setSubmissionRecordModal({ open: false, user: null })}>
            Close
          </Button>
        }
        width={960}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12, borderRadius: 8 }}
          message="Raw disposal submissions for this portal user"
          description="View, edit, change status, or delete the submissions raised by this account. Changes apply immediately to the live records."
        />
        <ResponsiveTable
          dataSource={submissionRecords}
          rowKey="_id"
          loading={submissionRecordsLoading}
          pagination={{ pageSize: 8, size: "small" }}
          scroll={{ x: 820 }}
          columns={[
            {
              title: "ID No.",
              dataIndex: "idNo",
              key: "idNo",
              width: 150,
              render: (v, r) => (
                <Space direction="vertical" size={0}>
                  <Text strong style={{ fontSize: 12 }}>{v || "—"}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {r.dateOfDisposal ? dayjs(r.dateOfDisposal).format("MM/DD/YYYY") : "No date"}
                  </Text>
                </Space>
              ),
            },
            {
              title: "Company",
              dataIndex: "lguCompanyName",
              key: "company",
              render: (v, r) => (
                <Space direction="vertical" size={0}>
                  <Text style={{ fontSize: 12 }}>{v || "—"}</Text>
                  <Tag color={r.companyType === "Private" ? "green" : "blue"} style={{ fontSize: 10 }}>
                    {r.companyType || "—"}
                  </Tag>
                </Space>
              ),
            },
            {
              title: "Trucks",
              key: "trucks",
              width: 70,
              align: "center",
              render: (_, r) => (Array.isArray(r.trucks) ? r.trucks.length : r.truckCount || 0),
            },
            {
              title: "Status",
              dataIndex: "status",
              key: "status",
              width: 120,
              render: (v) => {
                const colors = {
                  pending: "gold",
                  acknowledged: "green",
                  rejected: "red",
                  reverted: "volcano",
                  revert_requested: "orange",
                };
                return <Tag color={colors[v] || "default"}>{String(v || "pending").replace("_", " ")}</Tag>;
              },
            },
            {
              title: "Actions",
              key: "actions",
              width: 180,
              fixed: "right",
              render: (_, r) => (
                <Space size={4} wrap>
                  <Tooltip title="Edit company / type">
                    <Button size="small" type="text" icon={<EditOutlined />} style={{ color: "#2f54eb" }} onClick={() => handleSubmissionRecordEdit(r)} />
                  </Tooltip>
                  <Tooltip title="Acknowledge">
                    <Button size="small" type="text" icon={<CheckCircleOutlined />} style={{ color: "#52c41a" }} onClick={() => handleSubmissionRecordStatus(r, "acknowledged")} />
                  </Tooltip>
                  <Tooltip title="Reject">
                    <Button size="small" type="text" icon={<CloseCircleOutlined />} style={{ color: "#fa8c16" }} onClick={() => handleSubmissionRecordStatus(r, "rejected")} />
                  </Tooltip>
                  <Tooltip title="Delete submission">
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => handleSubmissionRecordDelete(r)} />
                  </Tooltip>
                </Space>
              ),
            },
          ]}
          locale={{ emptyText: <Empty description="No submissions for this user" /> }}
        />
      </Modal>
      <Modal
        title="Reset Portal Password"
        open={portalPasswordModal.open}
        onCancel={() => setPortalPasswordModal({ open: false, record: null })}
        onOk={resetPortalPassword}
        confirmLoading={portalSecuritySaving}
        okText="Reset Password"
        destroyOnHidden
      >
        <Form form={portalPasswordForm} layout="vertical">
          <Form.Item
            name="password"
            label="New Password"
            rules={[{ required: true, min: 6, message: "Password must be at least 6 characters" }]}
          >
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="Send Security Warning Email"
        open={portalWarningModal.open}
        onCancel={() => setPortalWarningModal({ open: false, record: null })}
        onOk={sendPortalWarning}
        confirmLoading={portalSecuritySaving}
        okText="Send Warning"
        width={680}
        destroyOnHidden
      >
        <Form form={portalWarningForm} layout="vertical">
          <Form.Item name="subject" label="Subject" rules={[{ required: true, message: "Subject is required" }]}>
            <Input prefix={<MailOutlined />} />
          </Form.Item>
          <Form.Item name="message" label="Message" rules={[{ required: true, message: "Message is required" }]}>
            <TextArea rows={7} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={announcementModal.record ? "Edit Announcement" : "Create Announcement"}
        open={announcementModal.open}
        onCancel={() => setAnnouncementModal({ open: false, record: null })}
        onOk={saveAnnouncement}
        confirmLoading={announcementSaving}
        okText={announcementModal.record ? "Save Changes" : "Create"}
        width={760}
        destroyOnHidden
      >
        <Form form={announcementForm} layout="vertical">
          <Row gutter={[16, 0]}>
            <Col xs={24} md={8}>
              <Form.Item name="enabled" label="Publish" valuePropName="checked">
                <Switch checkedChildren="Published" unCheckedChildren="Draft" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="type" label="Format" rules={[{ required: true, message: "Select format" }]}>
                <Select options={[
                  { label: "Information", value: "info" },
                  { label: "Warning", value: "warning" },
                  { label: "Success", value: "success" },
                  { label: "Critical", value: "error" },
                ]} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="dismissible" label="Allow dismiss" valuePropName="checked">
                <Switch checkedChildren="Yes" unCheckedChildren="No" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="showOnLogin" label="Show on Login Page" valuePropName="checked">
                <Switch checkedChildren="Show" unCheckedChildren="Hide" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="showInPortal" label="Show Inside SLF Portal" valuePropName="checked">
                <Switch checkedChildren="Show" unCheckedChildren="Hide" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="startAt" label="Valid From">
                <DatePicker showTime style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="endAt" label="Valid Until">
                <DatePicker showTime style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="title" label="Announcement Title" rules={[{ required: true, message: "Enter a title" }]}>
            <Input placeholder="Important SLF Portal Notice" />
          </Form.Item>
          <Form.Item name="message" label="Announcement Message" rules={[{ required: true, message: "Enter a message" }]}>
            <TextArea rows={5} placeholder="Write the announcement shown on the login page and portal dashboard..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Drive Test Upload Modal */}
      <Modal
        title={
          <Space>
            <UploadOutlined style={{ color: "#13c2c2" }} />
            <span>Google Drive Test Upload</span>
          </Space>
        }
        open={testUploadModal.open}
        onCancel={() => setTestUploadModal({ open: false })}
        footer={
          <Space>
            <Button onClick={() => setTestUploadModal({ open: false })}>Close</Button>
            <Button
              type="primary"
              icon={<UploadOutlined />}
              loading={testUploading}
              onClick={handleTestUpload}
            >
              Run Test Upload
            </Button>
          </Space>
        }
        width={560}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16, borderRadius: 8 }}
          message="Uploads a real sample file to each configured Drive folder and verifies folder access, upload, metadata, view URL, and cleanup."
          description="Success is only reported after an actual file is uploaded. Choose to keep the file (marked as a test file) or delete it automatically."
        />
        <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 16 }}>
          <Col xs={24} md={12}>
            <Text style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Sample file type</Text>
            <Select
              value={testFileType}
              onChange={setTestFileType}
              style={{ width: "100%" }}
              options={[
                { value: "text", label: "Text (.txt)" },
                { value: "image", label: "Image (.png)" },
                { value: "pdf", label: "PDF (.pdf)" },
                { value: "excel", label: "Excel/CSV (.csv)" },
              ]}
            />
          </Col>
          <Col xs={24} md={12}>
            <Text style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Keep uploaded test file</Text>
            <Switch
              checked={testKeep}
              onChange={setTestKeep}
              checkedChildren="Keep"
              unCheckedChildren="Delete"
            />
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
              {testKeep ? "File is kept and tagged [TEST]." : "File is deleted after verification."}
            </Text>
          </Col>
        </Row>
        {testUploading && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <Spin size="large" tip="Uploading test file…" />
          </div>
        )}
        {testUploadResults && !testUploading && (
          <div>
            <Alert
              type={testUploadResults.ok ? "success" : "error"}
              showIcon
              icon={testUploadResults.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
              style={{ marginBottom: 12, borderRadius: 8 }}
              message={testUploadResults.message}
            />
            {(testUploadResults.results || []).map((r) => {
              const stepLabels = [
                ["folderAccess", "Folder access"],
                ["upload", "File upload"],
                ["metadata", "Metadata"],
                ["viewUrl", "View URL"],
                ["cleanup", "Cleanup"],
              ];
              return (
                <div
                  key={r.key}
                  style={{
                    padding: "8px 12px",
                    marginBottom: 6,
                    borderRadius: 8,
                    background: r.success ? "#f6ffed" : "#fff2f0",
                    border: `1px solid ${r.success ? "#b7eb8f" : "#ffccc7"}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {r.success
                      ? <CheckCircleOutlined style={{ color: "#52c41a", fontSize: 16 }} />
                      : <CloseCircleOutlined style={{ color: "#ff4d4f", fontSize: 16 }} />}
                    <Text strong style={{ fontSize: 13, flex: 1 }}>{r.label}</Text>
                    <Tag color={r.success ? "success" : "error"}>{r.success ? "OK" : "Failed"}</Tag>
                  </div>
                  <Text type="secondary" style={{ fontSize: 11, display: "block", margin: "4px 0" }}>{r.message}</Text>
                  {r.steps && (
                    <Space size={4} wrap style={{ marginTop: 2 }}>
                      {stepLabels.map(([key, label]) => {
                        const val = r.steps[key];
                        if (val === null) return null; // cleanup skipped (keep=true)
                        return (
                          <Tag key={key} color={val ? "green" : "default"} style={{ fontSize: 10 }}>
                            {val ? "✓" : "•"} {label}
                          </Tag>
                        );
                      })}
                    </Space>
                  )}
                  {r.success && (r.fileName || r.mimeType || r.size != null) && (
                    <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
                      {r.fileName ? `${r.fileName} · ` : ""}{r.mimeType || ""}{r.size != null ? ` · ${(r.size / 1024).toFixed(1)} KB` : ""}
                      {r.fileId ? ` · ID ${r.fileId}` : ""}
                    </Text>
                  )}
                  {r.webViewLink && (
                    <a href={r.webViewLink} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>Open kept test file ↗</a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </div>
  );
}
