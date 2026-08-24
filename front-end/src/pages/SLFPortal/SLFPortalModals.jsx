import { useState } from "react";
import dayjs from "dayjs";
import {
  Avatar, Badge, Button, Checkbox, Col, Collapse, DatePicker, Descriptions, Divider,
  Empty, Form, Grid, Input, InputNumber, List,
  Modal, Progress, Radio, Row, Select, Space, Spin, Table, Tabs, Tag, Tooltip, Upload,
  Typography, Card, Alert, Skeleton
} from "antd";

// `Option` is used as <Option> below. Without this destructure it resolves to the
// browser's global Option constructor (HTMLOptionElement), and React throws
// "Please use the 'new' operator, this DOM object constructor cannot be called as
// a function". eslint's no-undef cannot flag it — window.Option is a real global.
const { Option } = Select;
import {
  AuditOutlined, BankOutlined, BarChartOutlined, CarOutlined, CheckCircleOutlined,
  CloseCircleOutlined, ContainerOutlined, DatabaseOutlined, DeleteOutlined,
  DownloadOutlined, EditOutlined, EnvironmentOutlined, EyeOutlined, FileTextOutlined,
  InfoCircleOutlined, MailOutlined, MessageOutlined, PieChartOutlined,
  PlusOutlined, ProfileOutlined, SaveOutlined, SendOutlined,
  TeamOutlined, UndoOutlined, UploadOutlined, UserOutlined, WifiOutlined,
  ClockCircleOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { EMPTY_VEHICLE } from "./constants";
import { mergeSelectOptions } from "./helpers";
import { UPLOAD_COLUMNS } from "./uploadHelpers";
import HaulerUploadGuide from "./HaulerUploadGuide";
import HaulerClientListPanel from "./HaulerClientListPanel";
import VeraFlameIcon from "../../components/VeraFlameIcon";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "../../config/appContact";
import api from "../../api";
import secureStorage from "../../utils/secureStorage";
import { convertVolume } from "../../utils/volumeUnits";
import {
  buildSubmissionWasteEntries,
  formatWasteEntryTotals,
} from "../../utils/submissionEntries";
import { useSensitiveMask, MASK_PLACEHOLDER } from "../../utils/sensitiveMask";

const { Text } = Typography;
const { TextArea } = Input;
const normalizeUnitLabel = (unit) => String(unit || "tons").replace("m3", "m³");
const UPLOAD_PREVIEW_LONG_TEXT_FIELDS = [
  "haulerName",
  "officeAddress",
  "clientAddress",
  "clientRegion",
  "clientProvince",
  "clientMunicipality",
  "hauler",
  "client",
];
const UPLOAD_PREVIEW_POPUP_CLASS = "slf-upload-preview-popup";

function convertCellDraftUnit(draft, nextUnit, declaredUnit) {
  const from = normalizeUnitLabel(draft.unit || declaredUnit || "tons");
  const to = normalizeUnitLabel(nextUnit);
  if (from === to) return { ...draft, unit: to };

  const converted = convertVolume(draft.volume, from, to);
  return {
    ...draft,
    unit: to,
    volume:
      converted === null ? draft.volume : Math.round(converted * 100) / 100,
  };
}

function CellEntryUnitHint({ draftUnit, declaredUnit }) {
  const declared = normalizeUnitLabel(declaredUnit || "tons");
  const current = normalizeUnitLabel(draftUnit || declaredUnit || "tons");
  if (current === declared) {
    return (
      <span style={{ fontSize: 11 }}>
        Declared unit for this SLF: <strong>{declared}</strong>
      </span>
    );
  }
  return (
    <span style={{ fontSize: 11, color: "#d46b08" }}>
      This SLF declares <strong>{declared}</strong>. Saving in {current} — the value
      is converted to {declared} for all capacity calculations.
    </span>
  );
}

// Extract a Google Drive file ID from any common Drive URL shape so images can
// be shown from a direct thumbnail endpoint (webViewLink pages don't load in <img>).
const driveIdFromUrl = (url) => {
  if (!url) return null;
  const s = String(url);
  const m =
    s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    s.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
    s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
};

const TicketAttachment = ({ att, index }) => {
  const norm =
    typeof att === "string"
      ? { url: att, name: "", mimeType: "" }
      : att && typeof att === "object"
        ? att
        : null;
  const [errored, setErrored] = useState(false);
  if (!norm || !norm.url) {
    return (
      <span
        style={{
          fontSize: 11,
          color: "#cf1322",
          border: "1px dashed #ffbfbf",
          borderRadius: 6,
          padding: "4px 8px",
        }}
      >
        Attachment unavailable
      </span>
    );
  }
  const isImage = (norm.mimeType || "").startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(norm.url);
  const driveId = norm.fileId || driveIdFromUrl(norm.url);
  const imgSrc = driveId ? `https://drive.google.com/thumbnail?id=${driveId}&sz=w200` : norm.url;

  if (isImage && !errored) {
    return (
      <a href={norm.url} target="_blank" rel="noreferrer" title={norm.name || `attachment-${index + 1}`}>
        <img
          src={imgSrc}
          alt={norm.name || `attachment-${index + 1}`}
          style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, border: "1px solid #eee" }}
          onError={() => setErrored(true)}
        />
      </a>
    );
  }
  return (
    <a
      href={norm.url}
      target="_blank"
      rel="noreferrer"
      style={{
        fontSize: 12,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "6px 10px",
        border: "1px solid #eee",
        borderRadius: 6,
        background: "#fafafa",
      }}
    >
      <FileTextOutlined /> {norm.name || `Attachment ${index + 1}`}
    </a>
  );
};

const SUPPORT_TAB_KEYS = ["new-ticket", "my-tickets"];
const SUPPORT_CATEGORY_OPTIONS = [
  { label: "Technical Issue", value: "Technical Issue" },
  { label: "Data Correction", value: "Data Correction" },
  { label: "Account Issue", value: "Account Issue" },
  { label: "Requirements / Compliance", value: "Requirements / Compliance" },
  { label: "Submission Concern", value: "Submission Concern" },
  { label: "Feature Request", value: "Feature Request" },
  { label: "Other", value: "Other" },
];
const SUPPORT_PRIORITY_OPTIONS = [
  { label: "Low", value: "Low" },
  { label: "Medium", value: "Medium" },
  { label: "High", value: "High" },
  { label: "Urgent", value: "Urgent" },
];

const getSupportStatusColor = (status) =>
  status === "open"
    ? "blue"
    : status === "in_progress"
      ? "orange"
      : status === "resolved"
        ? "green"
        : "default";

const getSupportPriorityColor = (priority) =>
  priority === "Urgent"
    ? "red"
    : priority === "High"
      ? "orange"
      : priority === "Medium"
        ? "gold"
        : "default";

// All SLF Portal modals — receives all state/handlers via props
export default function SLFPortalModals({
  // Form instances
  entryForm, baselineForm, companyForm, supportForm,
  // State
  haulerModalOpen, setHaulerModalOpen,
  haulerDraft, setHaulerDraft,
  editingHaulerKey, setEditingHaulerKey,
  haulerErrors, setHaulerErrors,
  haulerProvinces, setHaulerProvinces,
  haulerCities, setHaulerCities,
  haulerBarangayList, setHaulerBarangayList,
  loadingHaulerAddress, setLoadingHaulerAddress,
  fetchHaulerProvinces, fetchHaulerCities, fetchHaulerBarangays,
  clientModalOpen, setClientModalOpen,
  editingClientKey, setEditingClientKey,
  clientDraft, setClientDraft,
  clientProvinces, setClientProvinces,
  clientMunicipalities, setClientMunicipalities,
  loadingClientAddress, setLoadingClientAddress,
  truckModalOpen, setTruckModalOpen,
  truckDraft, setTruckDraft,
  editingTruckKey, setEditingTruckKey,
  truckErrors, setTruckErrors,
  historyDetailModal, setHistoryDetailModal,
  historyDetailLoading, historyDetailError, closeHistoryDetail,
  reviewModalOpen, setReviewModalOpen,
  revertModalOpen, setRevertModalOpen,
  revertRecord, setRevertRecord,
  revertReason, setRevertReason,
  revertLoading,
  profileModalOpen, setProfileModalOpen,
  supportDrawerOpen, setSupportDrawerOpen,
  messageDrawerOpen, setMessageDrawerOpen,
  supportTab, setSupportTab,
  supportTickets,
  supportTicketPagination = { current: 1, pageSize: 10, total: 0 },
  supportTicketSearch = "",
  supportTicketSorter = { field: "createdAt", order: "descend" },
  portalNotificationCounts = {},
  markPortalNotificationsRead = () => {},
  supportLoading,
  supportSubmitting,
  fetchSupportTickets,
  faqActiveKey, setFaqActiveKey,
  supportDetailModal, setSupportDetailModal,
  supportReplyText, setSupportReplyText,
  uploadModalOpen, setUploadModalOpen,
  uploadType, setUploadType,
  uploadGuideOpen, setUploadGuideOpen,
  uploadGuideType, setUploadGuideType,
  uploadPreviewData,
  uploadPreviewColumns,
  uploadPreviewSummary = {},
  uploadMissingColumns,
  setUploadPreviewData,
  setUploadPreviewColumns,
  setUploadMissingColumns,
  uploadProgressOpen, uploadProgress, uploadStatusText, uploadProgressError, setUploadProgressOpen,
  ticketAttachments = [], setTicketAttachments = () => {},
  ticketUploading = false, setTicketUploading = () => {},
  activeCellModalOpen, setActiveCellModalOpen,
  activeCellDraft, setActiveCellDraft,
  editingActiveCellKey, setEditingActiveCellKey,
  closedCellModalOpen, setClosedCellModalOpen,
  closedCellDraft, setClosedCellDraft,
  editingClosedCellKey, setEditingClosedCellKey,
  haulerDeleteModal, setHaulerDeleteModal,
  haulerDeleteReason, setHaulerDeleteReason,
  haulerDeleteFile, setHaulerDeleteFile,
  haulerDeleteLoading,
  setHaulerDeleteLoading,
  leachateModalOpen, setLeachateModalOpen,
  leachateDetails, setLeachateDetails,
  gasVentModalOpen, setGasVentModalOpen,
  gasVentDetails, setGasVentDetails,
  trashSlideModalOpen, setTrashSlideModalOpen,
  trashSlideDetails, setTrashSlideDetails,
  firePrevModalOpen, setFirePrevModalOpen,
  firePrevDetails, setFirePrevDetails,
  facilityMgmtSaving,
  wasteReceivedModalOpen, setWasteReceivedModalOpen,
  wasteReceivedData,
  wasteReceivedLoading,
  activeCellEntries,
  activeCellOptions = [],
  cellPlacementOptions = [],
  slfInfoLoading = false,
  slfCellCount = 0,
  baselineCellOptions = [],
  closedCellEntries,
  haulers,
  trucks,
  baselineUnit,
  baselineSaved,
  submissions,
  portalUser,
  portalCredentialSelfServiceEnabled = false,
  onCredentialUpdated,
  activeSlfId,
  activeSlfName,
  slfInfo,
  regions,
  provinces,
  municipalities,
  barangays,
  extraTransportFields,
  acceptsHazardousWaste,
  hazWasteCodes,
  isMobile,
  // Handlers
  handleSaveHauler,
  updateHaulerDraft,
  updateHaulerDraftAddr,
  openHaulerModal,
  handleSaveClient,
  handleSaveTruck,
  updateTruckDraft,
  updateVehicle,
  openRevertModal,
  handleRequestRevert,
  handleConfirmSubmit,
  handleReviewOpen,
  handleSaveDraft,
  savingDraft,
  openScheduleModal,
  handleSubmitTicket,
  handleSupportReply,
  handleSaveActiveCellEntry,
  handleSaveClosedCellEntry,
  handleConfirmUpload,
  proceedToFilePicker,
  downloadDisposalTemplate,
  downloadHaulerTemplate = () => {},
  exportHaulerData = () => {},
  exportSingleHaulerData = () => {},
  haulerModalFocus = "basic",
  haulerVeraStage = "idle",
  haulerVeraComment = "",
  haulerVeraError = null,
  haulerVeraSource = null,
  reassessHaulerUpload = () => {},
  updateUploadCell,
  handleOpenWasteReceived,
  handleSaveFacilityDetails,
  handleEditReverted,
  handleResubmitReverted,
  renderStatusTag,
  fl, isRequired, opts, fieldErr,
  loading,
  resubmitComment, setResubmitComment,
  editingRevertedId, setEditingRevertedId,
}) {
  // Global SLF sensitive-value masking (read displays only — never input fields).
  const { masked: maskSensitiveValues } = useSensitiveMask();
  const screens = Grid.useBreakpoint();
  const isNarrowScreen = !screens.lg;
  const [credentialForm] = Form.useForm();
  const [credentialCodeRequested, setCredentialCodeRequested] = useState(false);
  const [credentialLoading, setCredentialLoading] = useState(false);
  const [locationSharing, setLocationSharing] = useState(
    !!portalUser?.locationSharingEnabled,
  );
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationLabel, setLocationLabel] = useState(
    portalUser?.lastKnownLocation?.label || "",
  );
  // #1: open-cell picker table. Holds { vi, options } for the vehicle whose cell
  // is being chosen from the compact selectable table; null when closed.
  const [cellPicker, setCellPicker] = useState(null);

  // Apply a picked open cell to the vehicle the picker was opened for.
  const applyPickedCell = (opt) => {
    if (!cellPicker) return;
    const vi = cellPicker.vi;
    const updated = [...(truckDraft.vehicles || [])];
    if (!updated[vi]) return;
    updated[vi] = {
      ...updated[vi],
      cellName: opt?.value || "",
      cellType: opt?.cellType || "",
      cellIndex: opt && typeof opt.cellIndex === "number" ? opt.cellIndex : null,
    };
    updateTruckDraft("vehicles", updated);
    setCellPicker(null);
  };

  // Toggle browser location sharing for activity tracing.
  const handleLocationSharingToggle = async (enabled) => {
    setLocationBusy(true);
    try {
      if (!enabled) {
        await api.patch("/portal-auth/location", { enabled: false });
        setLocationSharing(false);
        setLocationLabel("");
        return;
      }
      if (!("geolocation" in navigator)) {
        await api.patch("/portal-auth/location", { enabled: true });
        setLocationSharing(true);
        return;
      }
      // Request the current position, then persist it.
      await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const { latitude, longitude, accuracy } = pos.coords;
            const label = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
            try {
              await api.patch("/portal-auth/location", {
                enabled: true,
                lat: latitude,
                lng: longitude,
                accuracy,
                label,
              });
              setLocationSharing(true);
              setLocationLabel(label);
            } catch {
              /* ignore */
            }
            resolve();
          },
          async () => {
            // Permission denied / unavailable — still record the preference.
            try {
              await api.patch("/portal-auth/location", { enabled: true });
              setLocationSharing(true);
            } catch {
              /* ignore */
            }
            resolve();
          },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
        );
      });
    } catch {
      /* ignore */
    } finally {
      setLocationBusy(false);
    }
  };

  const haulerFieldErr = (name) =>
    haulerErrors[name]
      ? { validateStatus: "error", help: haulerErrors[name] }
      : {};
  const adminMessages = (supportTickets || []).filter((ticket) => ticket.source === "admin_message");
  const portalSupportTickets = (supportTickets || []).filter((ticket) => ticket.source !== "admin_message");
  const uniqueHaulers = Array.from(
    new Map(
      (haulers || [])
        .filter((hauler) => hauler?.haulerName)
        .map((hauler) => [hauler.haulerName.trim().toLowerCase(), hauler]),
    ).values(),
  );
  const messageUnreadCount = portalNotificationCounts.messages || 0;
  const supportUnreadCount = portalNotificationCounts.support || 0;
  const supportTicketColumns = [
    {
      title: "Ticket",
      dataIndex: "ticketNo",
      key: "ticketNo",
      sorter: true,
      width: 130,
      render: (value) => <Text strong>{value || "—"}</Text>,
    },
    {
      title: "Subject",
      dataIndex: "subject",
      key: "subject",
      sorter: true,
      render: (value, ticket) => (
        <Button type="link" size="small" onClick={() => setSupportDetailModal(ticket)} style={{ padding: 0, whiteSpace: "normal", height: "auto", textAlign: "left" }}>
          {value || "—"}
        </Button>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      sorter: true,
      width: 130,
      render: (value) => <Tag color={getSupportStatusColor(value)}>{String(value || "open").replace("_", " ").toUpperCase()}</Tag>,
    },
    {
      title: "Priority",
      dataIndex: "priority",
      key: "priority",
      sorter: true,
      width: 110,
      render: (value) => <Tag color={getSupportPriorityColor(value)}>{value || "Medium"}</Tag>,
    },
    {
      title: "Category",
      dataIndex: "category",
      key: "category",
      sorter: true,
      width: 170,
      render: (value) => value || "—",
    },
    {
      title: "Created",
      dataIndex: "createdAt",
      key: "createdAt",
      sorter: true,
      defaultSortOrder: supportTicketSorter.field === "createdAt" ? supportTicketSorter.order : undefined,
      width: 170,
      render: (value) => value ? dayjs(value).format("MMM D, YYYY h:mm A") : "—",
    },
  ];
  const resolvedSupportTab = SUPPORT_TAB_KEYS.includes(supportTab)
    ? supportTab
    : "new-ticket";
  const uploadClientOptions = Array.from(
    new Map(
      (haulers || [])
        .flatMap((hauler) => hauler?.privateSectorClients || [])
        .map((client, index) => {
          const name = typeof client === "string" ? client : client?.clientName;
          const trimmedName = String(name || "").trim();
          return trimmedName
            ? [trimmedName.toLowerCase(), { label: trimmedName, value: trimmedName, key: trimmedName || index }]
            : null;
        })
        .filter(Boolean),
    ).values(),
  );

  const requestCredentialCode = async () => {
    setCredentialLoading(true);
    try {
      const values = await credentialForm.validateFields(["username", "password"]);
      await api.post(
        "/portal-auth/credentials/request-code",
        values,
        { headers: { Authorization: `Bearer ${secureStorage.get("portal_token")}` } },
      );
      setCredentialCodeRequested(true);
      Modal.success({
        title: "Verification code sent",
        content: "Check your registered email for the 6-digit verification code.",
      });
    } catch (err) {
      if (err?.errorFields) return;
      Modal.error({
        title: "Could not send code",
        content: err.response?.data?.message || "Please try again.",
      });
    } finally {
      setCredentialLoading(false);
    }
  };

  const saveCredentials = async () => {
    setCredentialLoading(true);
    try {
      const values = await credentialForm.validateFields();
      await api.post(
        "/portal-auth/credentials/update",
        values,
        { headers: { Authorization: `Bearer ${secureStorage.get("portal_token")}` } },
      );
      Modal.success({
        title: "Credentials updated",
        content: "Please log in again using your updated credentials.",
        onOk: () => onCredentialUpdated?.(),
      });
    } catch (err) {
      if (err?.errorFields) return;
      Modal.error({
        title: "Could not update credentials",
        content: err.response?.data?.message || "Please check the code and try again.",
      });
    } finally {
      setCredentialLoading(false);
    }
  };
  const formatClientVolume = (row = {}) => {
    // Read-display of a client's disposed volume — mask when the global SLF
    // sensitive-value privacy toggle is on. (Data-entry inputs below stay
    // unmasked so a user always sees the value they are typing.)
    if (maskSensitiveValues) return MASK_PLACEHOLDER;
    const parts = [];
    const m3 = Number(row.totalM3 ?? row.m3 ?? 0);
    const tons = Number(row.totalTons ?? row.tons ?? 0);
    if (m3 > 0) parts.push(`${m3.toLocaleString()} m³`);
    if (tons > 0) parts.push(`${tons.toLocaleString()} tons`);
    if (parts.length) return parts.join(" / ");
    if (Number(row.totalVolume || 0) > 0) return `${Number(row.totalVolume || 0).toLocaleString()} ${row.unit || baselineUnit || baselineUnit}`;
    return "—";
  };
  const getClientCategory = (row = {}) => {
    const type = row.clientType || row.companyType || "Private";
    const region = row.region || row.companyRegion || "";
    if (/baseline/i.test(type)) return "Baseline Utilization";
    if (/lgu/i.test(type)) return String(region).startsWith("03") ? "LGU - Region III" : "LGU - Outside Region III";
    return "Private Industry";
  };
  const getAddressLabel = (row = {}, field) => {
    const nameKey = `${field}Name`;
    const value = row[field];
    if (row[nameKey]) return row[nameKey];
    const options = field === "province"
      ? [...(clientProvinces || []), ...(provinces || [])]
      : [...(clientMunicipalities || []), ...(municipalities || [])];
    return options.find((item) => String(item.code) === String(value))?.name || value || "—";
  };
  const legacySubmissionRows = [
    ...(wasteReceivedData.lguR3 || []).map((row) => ({ ...row, clientName: row.company, clientType: "LGU", region: row.region, unit: "m³" })),
    ...(wasteReceivedData.lguOutside || []).map((row) => ({ ...row, clientName: row.company, clientType: "LGU", region: row.region, unit: "m³" })),
    ...(wasteReceivedData.privateIndustry || []).map((row) => ({ ...row, clientName: row.company, clientType: "Private", region: row.region, unit: "m³" })),
  ].filter((row) => Number(row.totalVolume || 0) > 0 || Number(row.entries || 0) > 0);
  const submittedBreakdownRows = (wasteReceivedData.clientBreakdown || wasteReceivedData.submissionClients || []).length
    ? (wasteReceivedData.clientBreakdown || wasteReceivedData.submissionClients || [])
    : legacySubmissionRows;
  const baselineBreakdownRows = (wasteReceivedData.baselineClients || []).length
    ? wasteReceivedData.baselineClients || []
    : wasteReceivedData.baselineCellBreakdown || [];
  const baselineCategoryCounts = baselineBreakdownRows.reduce((acc, row) => {
    const category = getClientCategory(row);
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
  const submissionCategoryCounts = submittedBreakdownRows.reduce((acc, row) => {
    const category = getClientCategory(row);
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
  const categoryColors = {
    "LGU - Region III": "#1677ff",
    "LGU - Outside Region III": "#722ed1",
    "Private Industry": "#52c41a",
    "Baseline Utilization": "#fa8c16",
  };
  const renderCategoryDonuts = (counts, total, prefix) => (
    <Row gutter={[8, 8]}>
      {Object.entries(counts).length === 0 ? (
        <Col span={24}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No category data" />
        </Col>
      ) : Object.entries(counts).map(([label, count]) => {
        const percent = total ? Math.round((count / total) * 100) : 0;
        return (
          <Col xs={12} md={6} key={`${prefix}-${label}`}>
            <div style={{ textAlign: "center", padding: "8px 4px" }}>
              <Progress
                type="circle"
                size={58}
                percent={percent}
                strokeColor={categoryColors[label] || "#8c8c8c"}
                format={() => `${count}`}
              />
              <div style={{ marginTop: 6, fontSize: 10, lineHeight: 1.2, color: "#595959" }}>{label}</div>
            </div>
          </Col>
        );
      })}
    </Row>
  );

  return (
    <>
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
        {/* This hauler's own record, in the 13-column layout the Accredited
            Haulers uploader reads — so a single hauler can be pulled out,
            corrected in Excel and sent back through the baseline-wide upload
            without exporting the whole facility. */}
        <div style={{ marginBottom: 8 }}>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={() => exportSingleHaulerData(haulerDraft)}
            disabled={!haulerDraft.haulerName}
          >
            Export Hauler Data
          </Button>
        </div>
        <Collapse
          bordered={false}
          expandIconPlacement="end"
          // Opens on the section the user came in for: the Clients panel when
          // they picked the row's client-list action, Basic Information
          // otherwise. `destroyOnHidden` on the modal means this re-applies on
          // every open rather than sticking from a previous edit.
          defaultActiveKey={[haulerModalFocus || "basic"]}
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
                          filterOption={(input, opt) =>
                            opt?.label
                              ?.toLowerCase()
                              .includes(input.toLowerCase())
                          }
                          options={regions.map((r) => ({
                            value: r.code,
                            label: r.name,
                          }))}
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
                          filterOption={(input, opt) =>
                            opt?.label
                              ?.toLowerCase()
                              .includes(input.toLowerCase())
                          }
                          options={haulerProvinces.map((p) => ({
                            value: p.code,
                            label: p.name,
                          }))}
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
                          filterOption={(input, opt) =>
                            opt?.label
                              ?.toLowerCase()
                              .includes(input.toLowerCase())
                          }
                          options={haulerCities.map((c) => ({
                            value: c.code,
                            label: c.name,
                          }))}
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
                          onChange={(code) =>
                            updateHaulerDraft("officeBarangay", code)
                          }
                          filterOption={(input, opt) =>
                            opt?.label
                              ?.toLowerCase()
                              .includes(input.toLowerCase())
                          }
                          options={haulerBarangayList.map((b) => ({
                            value: b.code,
                            label: b.name,
                          }))}
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
                          <Form.Item
                            label="Plate Number"
                            style={{ marginBottom: 8 }}
                          >
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
                          <Form.Item
                            label="Vehicle Type"
                            style={{ marginBottom: 8 }}
                          >
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
                          {/* Vehicle Capacity is REQUIRED: a truck's capacity is
                              what the submission's over-capacity check measures
                              against, and a submission cannot be finalised without
                              it. Flag it inline so it is fixed here, not at submit. */}
                          <Form.Item
                            label="Capacity"
                            required
                            validateStatus={
                              v.capacity === null ||
                              v.capacity === undefined ||
                              v.capacity === "" ||
                              !(Number(v.capacity) > 0)
                                ? "error"
                                : ""
                            }
                            help={
                              v.capacity === null ||
                              v.capacity === undefined ||
                              v.capacity === ""
                                ? "Required"
                                : !(Number(v.capacity) > 0)
                                  ? "Must be > 0"
                                  : undefined
                            }
                            style={{ marginBottom: 8 }}
                          >
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
                              value={v.capacityUnit || baselineUnit || baselineUnit}
                              placeholder="Select unit"
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
                  {(haulerDraft.privateSectorClients || []).length > 0 && (
                    <Tag color="blue" style={{ marginLeft: 8 }}>
                      {haulerDraft.privateSectorClients.length}
                    </Tag>
                  )}
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
                        setClientDraft({
                          clientName: "",
                          clientType: "Private",
                          region: "",
                          province: "",
                          municipality: "",
                        });
                        setClientProvinces([]);
                        setClientMunicipalities([]);
                        setClientModalOpen(true);
                      }}
                    >
                      Add Client
                    </Button>
                  </div>
                  {/* Bulk maintenance for THIS hauler's clients. Scoped to the
                      hauler being edited, so the file carries no Hauler Name to
                      get wrong — see HaulerClientListPanel. */}
                  <HaulerClientListPanel
                    haulerDraft={haulerDraft}
                    updateHaulerDraft={updateHaulerDraft}
                  />
                  <Table
                    dataSource={haulerDraft.privateSectorClients || []}
                    rowKey="key"
                    size="small"
                    pagination={false}
                    locale={{
                      emptyText: (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          No clients added yet.
                        </Text>
                      ),
                    }}
                    columns={[
                      {
                        title: "Client Name",
                        dataIndex: "clientName",
                        key: "clientName",
                        render: (v) => v || "—",
                      },
                      {
                        title: "Type",
                        dataIndex: "clientType",
                        key: "clientType",
                        width: 80,
                        render: (v) => (
                          <Tag color={v === "LGU" ? "blue" : "green"}>{v}</Tag>
                        ),
                      },
                      {
                        title: "Location",
                        key: "location",
                        render: (_, r) =>
                          [
                            r.regionName || r.region,
                            r.provinceName || r.province,
                            r.municipalityName || r.municipality,
                          ]
                            .filter(Boolean)
                            .join(" / ") || "—",
                      },
                      {
                        title: "Actions",
                        key: "act",
                        width: 80,
                        render: (_, r) => (
                          <Space size="small">
                            <Button
                              type="text"
                              size="small"
                              icon={<EditOutlined />}
                              onClick={async () => {
                                setEditingClientKey(r.key);
                                setClientDraft({
                                  clientName: r.clientName,
                                  clientType: r.clientType,
                                  region: r.region,
                                  province: r.province,
                                  municipality: r.municipality,
                                });
                                setClientProvinces([]);
                                setClientMunicipalities([]);
                                if (r.region) {
                                  setLoadingClientAddress("province");
                                  try {
                                    const res = await fetch(
                                      `https://psgc.gitlab.io/api/regions/${r.region}/provinces/`,
                                    );
                                    setClientProvinces(await res.json());
                                  } catch (_) {}
                                  setLoadingClientAddress("");
                                }
                                if (r.province) {
                                  setLoadingClientAddress("municipality");
                                  try {
                                    const res = await fetch(
                                      `https://psgc.gitlab.io/api/provinces/${r.province}/cities-municipalities/`,
                                    );
                                    setClientMunicipalities(await res.json());
                                  } catch (_) {}
                                  setLoadingClientAddress("");
                                }
                                setClientModalOpen(true);
                              }}
                              style={{ color: "#1a3353" }}
                            />
                            <Button
                              type="text"
                              danger
                              size="small"
                              icon={<DeleteOutlined />}
                              onClick={() =>
                                updateHaulerDraft(
                                  "privateSectorClients",
                                  (
                                    haulerDraft.privateSectorClients || []
                                  ).filter((c) => c.key !== r.key),
                                )
                              }
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              paddingRight: 32,
            }}
          >
            <div
              style={{
                background: "linear-gradient(135deg, #1a3353 0%, #1e4a7a 100%)",
                borderRadius: 10,
                width: 42,
                height: 42,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: "0 2px 8px rgba(26,51,83,0.35)",
              }}
            >
              <CarOutlined style={{ color: "#fff", fontSize: 20 }} />
            </div>
            <div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#1a3353",
                  lineHeight: 1.3,
                  letterSpacing: 0.2,
                }}
              >
                {editingTruckKey
                  ? "Edit Transport Entry"
                  : "Add Transport Entry"}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#8c8c8c",
                  fontWeight: 400,
                  marginTop: 2,
                }}
              >
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
        okButtonProps={{
          className: "slf-primary-btn",
          icon: editingTruckKey ? <EditOutlined /> : <PlusOutlined />,
        }}
        cancelButtonProps={{ icon: <CloseCircleOutlined /> }}
        destroyOnHidden
        width={1040}
        styles={{
          body: { paddingTop: 16, maxHeight: "72vh", overflowY: "auto" },
        }}
      >
        {/* ── Section 2: Trip Information ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "linear-gradient(90deg, #135200 0%, #237804 100%)",
            borderRadius: "8px 8px 0 0",
            padding: "9px 16px",
          }}
        >
          <AuditOutlined style={{ color: "#fff", fontSize: 14 }} />
          <Text
            strong
            style={{ color: "#fff", fontSize: 13, letterSpacing: 0.3 }}
          >
            Trip Information
          </Text>
        </div>
        <div
          style={{
            background: "#f6ffed",
            border: "1px solid #b7eb8f",
            borderTop: "none",
            borderRadius: "0 0 8px 8px",
            padding: "16px 16px 4px",
            marginBottom: 14,
          }}
        >
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
                  onChange={(e) =>
                    updateTruckDraft("disposalTicketNo", e.target.value)
                  }
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
                    updateTruckDraft("vehicles", [
                      {
                        ...EMPTY_VEHICLE,
                        key: Date.now(),
                        capacityUnit: baselineUnit || baselineUnit,
                      },
                    ]);
                  }}
                  filterOption={(input, option) =>
                    (option?.children ?? "")
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                  notFoundContent={
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      No haulers registered in baseline
                    </Text>
                  }
                >
                  {uniqueHaulers.map((h) => (
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "linear-gradient(90deg, #612500 0%, #873800 100%)",
            borderRadius: "8px 8px 0 0",
            padding: "9px 16px",
          }}
        >
          <CarOutlined style={{ color: "#fff", fontSize: 14 }} />
          <Text
            strong
            style={{ color: "#fff", fontSize: 13, letterSpacing: 0.3 }}
          >
            Vehicle, Waste &amp; Cell Placement
          </Text>
        </div>
        <div
          style={{
            background: "#fff7e6",
            border: "1px solid #ffd591",
            borderTop: "none",
            borderRadius: "0 0 8px 8px",
            padding: "16px 16px 4px",
            marginBottom: 14,
          }}
        >
          {truckErrors.plateNumber && (
            <Text
              type="danger"
              style={{ fontSize: 12, display: "block", marginBottom: 8 }}
            >
              {truckErrors.plateNumber}
            </Text>
          )}
          {(truckDraft.vehicles || []).map((veh, vi) => {
            const matchingHaulers = (haulers || []).filter(
              (h) => h.haulerName === truckDraft.hauler,
            );
            const haulerVehicles = matchingHaulers
              .flatMap((hauler) => hauler.vehicles || [])
              .filter((vehicle, index, list) =>
                vehicle?.plateNumber &&
                list.findIndex((item) => item.plateNumber === vehicle.plateNumber) === index,
              );
            // Per-vehicle cell options filtered by this vehicle's waste type so
            // hazardous loads only go to hazardous cells and vice-versa.
            const vehIsHaz = String(veh.wasteType || "")
              .toLowerCase()
              .includes("hazard");
            const byWasteType = (o) =>
              vehIsHaz
                ? String(o.cellType || "").toLowerCase().includes("haz")
                : !String(o.cellType || "").toLowerCase().includes("haz");
            // Selectable (available) cells for this waste type — drives the
            // empty-state logic and validation counts.
            const vehCellOptions = veh.wasteType
              ? activeCellOptions.filter(byWasteType)
              : activeCellOptions;
            // Display list including UNAVAILABLE cells (rendered disabled with a
            // reason) for context. Falls back to available-only when the full list
            // is not supplied.
            const vehCellDisplayOptions = (
              cellPlacementOptions.length ? cellPlacementOptions : activeCellOptions
            ).filter((o) => (veh.wasteType ? byWasteType(o) : true));
            // #1: distinct, diagnostic empty state. Never shown while the facility's
            // cell data is still loading — only once we KNOW no cell qualifies, and
            // then it says WHY (no cells / none open / none for this waste type).
            const cellEmptyReason = slfInfoLoading
              ? null
              : slfCellCount === 0
                ? "This facility has no cells configured yet. Contact EMB Region III."
                : activeCellOptions.length === 0
                  ? "No cells are currently open for disposal — they may be inactive, full, or restricted for your account. Contact EMB Region III."
                  : veh.wasteType && vehCellOptions.length === 0
                    ? `No open cell accepts ${vehIsHaz ? "hazardous" : "non-hazardous"} waste. Change the waste type or contact EMB Region III.`
                    : null;
            const patchVehicle = (patch) => {
              const updated = [...(truckDraft.vehicles || [])];
              updated[vi] = { ...updated[vi], ...patch };
              updateTruckDraft("vehicles", updated);
            };
            return (
              <div
                key={veh.key || vi}
                style={{
                  background: "#fff",
                  borderRadius: 8,
                  padding: "12px 14px",
                  marginBottom: 10,
                  border: "1px solid #ffd591",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <Text
                    type="secondary"
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    Vehicle {vi + 1}
                  </Text>
                  {(truckDraft.vehicles || []).length > 1 && (
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => {
                        const updated = (truckDraft.vehicles || []).filter(
                          (_, idx) => idx !== vi,
                        );
                        updateTruckDraft("vehicles", updated);
                      }}
                    />
                  )}
                </div>
                <Row gutter={[12, 0]} align="middle">
                  <Col xs={24} sm={10}>
                    <Form.Item
                      label={fl("plateNumber", "Plate Number")}
                      style={{ marginBottom: 4 }}
                    >
                      <Select
                        showSearch
                        allowClear
                        placeholder="Select or type plate number"
                        value={veh.plateNumber || undefined}
                        onChange={(val) => {
                          const updated = [...(truckDraft.vehicles || [])];
                          updated[vi] = {
                            ...updated[vi],
                            plateNumber: val || "",
                            selectedClients: [],
                          };
                          const match = haulerVehicles.find(
                            (hv) => hv.plateNumber === val,
                          );
                          if (match) {
                            updated[vi].capacity = match.capacity || null;
                            updated[vi].capacityUnit =
                              match.capacityUnit || baselineUnit || baselineUnit;
                          }
                          updateTruckDraft("vehicles", updated);
                        }}
                        filterOption={(input, option) =>
                          (option?.children ?? "")
                            .toLowerCase()
                            .includes(input.toLowerCase())
                        }
                        notFoundContent={
                          truckDraft.hauler
                            ? "No vehicles for this hauler"
                            : "Select a hauler first"
                        }
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
                    <Form.Item
                      label="Truck Capacity"
                      style={{ marginBottom: 4 }}
                      validateStatus={
                        truckErrors?.vehicles?.[vi]?.capacity ? "error" : ""
                      }
                      help={truckErrors?.vehicles?.[vi]?.capacity || ""}
                    >
                      <InputNumber
                        placeholder="Capacity"
                        style={{ width: "100%" }}
                        min={0}
                        step={0.1}
                        status={
                          truckErrors?.vehicles?.[vi]?.capacity ? "error" : ""
                        }
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
                    <Form.Item
                      label="Unit"
                      style={{ marginBottom: 4 }}
                      tooltip="Locked to your declared baseline unit"
                    >
                      {/* Locked to the declared baseline unit so no transport
                          entry can carry a mismatched unit. */}
                      <Select value={baselineUnit || baselineUnit} disabled>
                        <Option value="m³">m³</Option>
                        <Option value="tons">tons</Option>
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      label={fl("wasteType", "Waste Type")}
                      style={{ marginBottom: 4 }}
                    >
                      <Select
                        placeholder="Select waste classification"
                        value={veh.wasteType}
                        onChange={(val) => {
                          // Clear an incompatible cell when waste type changes.
                          const stillCompatible =
                            !veh.cellType ||
                            (String(val || "").toLowerCase().includes("hazard")
                              ? String(veh.cellType).toLowerCase().includes("haz")
                              : !String(veh.cellType).toLowerCase().includes("haz"));
                          patchVehicle({
                            wasteType: val,
                            ...(stillCompatible
                              ? {}
                              : { cellName: "", cellType: "", cellIndex: null }),
                            ...(String(val || "").toLowerCase().includes("hazard")
                              ? {}
                              : { hazWasteCode: [] }),
                          });
                        }}
                      >
                        {opts("wasteType", [
                          "Residual",
                          "Treated Hazardous Waste",
                        ]).map((o) => (
                          <Option key={o} value={o}>
                            {o}
                          </Option>
                        ))}
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col xs={14} sm={8}>
                    <Form.Item
                      label={
                        <Text style={{ fontSize: 12 }}>
                          <DatabaseOutlined style={{ marginRight: 4, color: "#722ed1" }} />
                          {fl("actualVolume", "Waste Volume")}
                        </Text>
                      }
                      style={{ marginBottom: 4 }}
                      validateStatus={
                        truckErrors?.vehicles?.[vi]?.actualVolume ? "error" : ""
                      }
                      help={truckErrors?.vehicles?.[vi]?.actualVolume || ""}
                    >
                      <InputNumber
                        placeholder="Volume to this cell"
                        style={{ width: "100%" }}
                        min={0}
                        step={0.01}
                        status={
                          truckErrors?.vehicles?.[vi]?.actualVolume ? "error" : ""
                        }
                        value={veh.actualVolume}
                        onChange={(val) => patchVehicle({ actualVolume: val })}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={10} sm={4}>
                    <Form.Item
                      label="Unit"
                      style={{ marginBottom: 4 }}
                      tooltip="Locked to your declared baseline unit"
                    >
                      {/* Locked to the declared baseline unit (see capacity unit). */}
                      <Select value={baselineUnit || baselineUnit} disabled>
                        <Option value="tons">tons</Option>
                        <Option value="m³">m³</Option>
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col xs={24}>
                    <Form.Item
                      label={
                        <Space size={4}>
                          <ContainerOutlined style={{ color: "#722ed1" }} />
                          {fl("disposalCell", "Disposal Cell")}
                        </Space>
                      }
                      tooltip="Active/open cell (set by the admin) where THIS vehicle's waste will be placed."
                      style={{ marginBottom: 4 }}
                      validateStatus={
                        truckErrors?.vehicles?.[vi]?.cellName ? "error" : ""
                      }
                      help={truckErrors?.vehicles?.[vi]?.cellName || ""}
                    >
                      <Select
                        showSearch
                        allowClear
                        loading={slfInfoLoading}
                        status={
                          truckErrors?.vehicles?.[vi]?.cellName ? "error" : ""
                        }
                        placeholder={
                          !veh.wasteType
                            ? "Select waste type first"
                            : slfInfoLoading
                              ? "Loading open cells…"
                              : vehCellOptions.length
                                ? "Select active open cell"
                                : "No open cells available"
                        }
                        // Only the loading state disables independently of waste type,
                        // so a valid open cell is always selectable once data is in.
                        disabled={!veh.wasteType || slfInfoLoading}
                        value={veh.cellName || undefined}
                        onChange={(val) => {
                          const opt = vehCellOptions.find((o) => o.value === val);
                          patchVehicle({
                            cellName: val || "",
                            cellType: opt?.cellType || "",
                            cellIndex:
                              opt && typeof opt.cellIndex === "number"
                                ? opt.cellIndex
                                : null,
                          });
                        }}
                        filterOption={(input, option) =>
                          (option?.children ?? "")
                            .toLowerCase()
                            .includes(input.toLowerCase())
                        }
                        notFoundContent={
                          slfInfoLoading ? (
                            <span style={{ fontSize: 12 }}>
                              <Spin size="small" style={{ marginRight: 6 }} /> Loading open cells…
                            </span>
                          ) : (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {cellEmptyReason || "No matching open cells. Contact EMB Region III."}
                            </Text>
                          )
                        }
                      >
                        {vehCellDisplayOptions.map((o) => (
                          <Option
                            key={o.value}
                            value={o.value}
                            disabled={o.disabled === true}
                          >
                            {o.disabled ? (
                              <span style={{ color: "#bfbfbf" }}>{o.label}</span>
                            ) : (
                              o.label
                            )}
                          </Option>
                        ))}
                      </Select>
                      {/* #1: open the compact selectable open-cell TABLE (capacity,
                          used, remaining, status) — only valid open cells appear and
                          are selectable. */}
                      {veh.wasteType && !slfInfoLoading && vehCellOptions.length > 0 && (
                        <Button
                          type="link"
                          size="small"
                          icon={<ContainerOutlined />}
                          style={{ padding: 0, marginTop: 4, height: "auto", fontSize: 12 }}
                          onClick={() => setCellPicker({ vi, options: vehCellOptions })}
                        >
                          Browse open cells in a table
                        </Button>
                      )}
                      {/* Distinct empty/error hint shown inline (not only in the
                          dropdown) so the user sees WHY no cell is selectable, and
                          never sees it while data is still loading. */}
                      {cellEmptyReason && veh.wasteType && (
                        <Text type="warning" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
                          {cellEmptyReason}
                        </Text>
                      )}
                      {veh.cellType && (
                        <Tag
                          color={vehIsHaz ? "volcano" : "geekblue"}
                          style={{ marginTop: 6, fontSize: 11 }}
                        >
                          {veh.cellType} Cell
                        </Tag>
                      )}
                    </Form.Item>
                  </Col>
                  {vehIsHaz && (
                    <Col xs={24}>
                      <Form.Item
                        label="Hazardous Waste Code (DENR EMB)"
                        tooltip="Required for Treated Hazardous Waste"
                        style={{ marginBottom: 4 }}
                      >
                        <Select
                          mode="multiple"
                          placeholder="Select DENR EMB hazardous waste code(s)"
                          value={veh.hazWasteCode || []}
                          onChange={(val) => patchVehicle({ hazWasteCode: val })}
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
                  )}
                  {(() => {
                    const haulerClients = matchingHaulers
                      .flatMap((hauler) => hauler.privateSectorClients || [])
                      .filter((client, index, list) => {
                        const name = typeof client === "object" ? client.clientName : client;
                        return name && list.findIndex((item) => (typeof item === "object" ? item.clientName : item) === name) === index;
                      });
                    if (!haulerClients.length || !veh.plateNumber) return null;
                    return (
                      <Col xs={24}>
                        <Form.Item
                          label={
                            <Text style={{ fontSize: 12 }}>
                              <TeamOutlined style={{ marginRight: 4 }} />
                              Clients for this Vehicle
                            </Text>
                          }
                          style={{ marginBottom: 4, marginTop: 4 }}
                        >
                          <Select
                            mode="multiple"
                            placeholder="Select clients for this vehicle"
                            value={(veh.selectedClients || []).map((c) =>
                              typeof c === "object" ? c.clientName : c,
                            )}
                            onChange={(vals) => {
                              const selected = vals.map((name) => {
                                const found = haulerClients.find(
                                  (c) => (c.clientName || c) === name,
                                );
                                if (found && typeof found === "object")
                                  return { ...found, key: found.key || name };
                                return {
                                  clientName: name,
                                  clientType: "Private",
                                  region: "",
                                  province: "",
                                  municipality: "",
                                  key: name,
                                };
                              });
                              const updated = [...(truckDraft.vehicles || [])];
                              updated[vi] = {
                                ...updated[vi],
                                selectedClients: selected,
                              };
                              updateTruckDraft("vehicles", updated);
                            }}
                            options={haulerClients.map((c) => ({
                              label:
                                typeof c === "object" ? (
                                  <span>
                                    {c.clientName}{" "}
                                    <Tag
                                      color={
                                        c.clientType === "LGU"
                                          ? "blue"
                                          : "green"
                                      }
                                      style={{ fontSize: 10, marginLeft: 4 }}
                                    >
                                      {c.clientType}
                                    </Tag>
                                  </span>
                                ) : (
                                  c
                                ),
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
              const updated = [
                ...(truckDraft.vehicles || []),
                {
                  ...EMPTY_VEHICLE,
                  key: Date.now(),
                  capacityUnit: baselineUnit || baselineUnit,
                  selectedClients: [],
                },
              ];
              updateTruckDraft("vehicles", updated);
            }}
            style={{ marginTop: 4, borderColor: "#fa8c16", color: "#fa8c16" }}
          >
            Add Vehicle
          </Button>
        </div>

        {/* ── Section 4: Waste Details ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "linear-gradient(90deg, #391085 0%, #531dab 100%)",
            borderRadius: "8px 8px 0 0",
            padding: "9px 16px",
          }}
        >
          <DatabaseOutlined style={{ color: "#fff", fontSize: 14 }} />
          <Text
            strong
            style={{ color: "#fff", fontSize: 13, letterSpacing: 0.3 }}
          >
            Waste Placement Summary
          </Text>
        </div>
        <div
          style={{
            background: "#f9f0ff",
            border: "1px solid #d3adf7",
            borderTop: "none",
            borderRadius: "0 0 8px 8px",
            padding: "14px 16px",
            marginBottom: extraTransportFields.length > 0 ? 14 : 0,
          }}
        >
          {(() => {
            const vehicles = (truckDraft.vehicles || []).filter(
              (v) => v.plateNumber || v.actualVolume,
            );
            if (!vehicles.length) {
              return (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Add a vehicle above and set its waste volume, type, and disposal
                  cell. Totals will appear here.
                </Text>
              );
            }
            const totalsByUnit = vehicles.reduce((acc, v) => {
              const unit = (v.actualVolumeUnit || baselineUnit || baselineUnit).replace(
                "m3",
                "m³",
              );
              const amount = Number(v.actualVolume || 0);
              if (amount) acc[unit] = (acc[unit] || 0) + amount;
              return acc;
            }, {});
            const totalLabel =
              Object.entries(totalsByUnit)
                .map(([unit, amount]) => `${amount.toLocaleString()} ${unit}`)
                .join(" + ") || "—";
            return (
              <>
                <Space style={{ marginBottom: 10 }} wrap>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Total Waste Volume
                  </Text>
                  <Tag color="purple" style={{ fontSize: 13, padding: "2px 10px" }}>
                    {totalLabel}
                  </Tag>
                </Space>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {vehicles.map((v, i) => (
                    <div
                      key={v.key || i}
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 8,
                        background: "#fff",
                        borderRadius: 6,
                        padding: "6px 10px",
                        border: "1px solid #efdbff",
                      }}
                    >
                      <Tag color="orange" style={{ margin: 0 }}>
                        {v.plateNumber || `Vehicle ${i + 1}`}
                      </Tag>
                      <Text style={{ fontSize: 12 }}>
                        {v.actualVolume != null
                          ? `${Number(v.actualVolume).toLocaleString()} ${(v.actualVolumeUnit || baselineUnit || baselineUnit).replace("m3", "m³")}`
                          : "No volume"}
                      </Text>
                      {v.wasteType && (
                        <Tag
                          color={
                            String(v.wasteType).toLowerCase().includes("hazard")
                              ? "volcano"
                              : "green"
                          }
                          style={{ margin: 0, fontSize: 11 }}
                        >
                          {v.wasteType}
                        </Tag>
                      )}
                      <ContainerOutlined style={{ color: "#722ed1" }} />
                      <Text style={{ fontSize: 12 }}>
                        {v.cellName ? (
                          v.cellName
                        ) : (
                          <Text type="danger" style={{ fontSize: 12 }}>
                            No cell assigned
                          </Text>
                        )}
                      </Text>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>

        {/* ── Section 5: Additional Fields (if any) ── */}
        {extraTransportFields.length > 0 && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "linear-gradient(90deg, #003a8c 0%, #0050b3 100%)",
                borderRadius: "8px 8px 0 0",
                padding: "9px 16px",
              }}
            >
              <ContainerOutlined style={{ color: "#fff", fontSize: 14 }} />
              <Text
                strong
                style={{ color: "#fff", fontSize: 13, letterSpacing: 0.3 }}
              >
                Additional Fields
              </Text>
            </div>
            <div
              style={{
                background: "#f0f5ff",
                border: "1px solid #adc6ff",
                borderTop: "none",
                borderRadius: "0 0 8px 8px",
                padding: "16px 16px 4px",
              }}
            >
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
                            <Option key={o} value={o}>
                              {o}
                            </Option>
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
                          onChange={(e) =>
                            updateTruckDraft(f.fieldKey, e.target.value)
                          }
                        />
                      ) : (
                        <Input
                          placeholder={f.fieldName}
                          value={truckDraft[f.fieldKey]}
                          onChange={(e) =>
                            updateTruckDraft(f.fieldKey, e.target.value)
                          }
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

      {/* ── Submission Detail Modal ──
          Opens INSTANTLY on the lean history row (id / company / date / status are
          already there) and fills in the heavy per-truck detail behind a skeleton as
          the full record arrives — instead of blocking on the request first, which
          is what made it feel slow. See openHistoryDetail() for the bounded cache. */}
      <Modal
        title={null}
        open={!!historyDetailModal}
        onCancel={closeHistoryDetail || (() => setHistoryDetailModal(null))}
        footer={null}
        width={1100}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
        closeIcon={
          <span
            style={{
              color: "#fff",
              fontSize: 18,
              fontWeight: 700,
              position: "relative",
              zIndex: 1,
            }}
          >
            ✕
          </span>
        }
      >
        {historyDetailModal &&
          (() => {
            const d = historyDetailModal;
            // Break the submission into its individual waste entries — a truck that
            // split its load across several vehicles contributes one row per vehicle,
            // each with its own waste type, volume, unit and cell.
            const wasteEntries = buildSubmissionWasteEntries(d, {
              slfName: d.slfName,
              fallbackUnit: baselineUnit,
            });
            // Previously this summed `actualVolume` across trucks with no regard for
            // each truck's unit and then labelled the result "tons" — a 5× error
            // whenever any entry was recorded in m³.
            const totalVolumeSummary = formatWasteEntryTotals(
              wasteEntries,
              d.totalVolumeAcceptedUnit || baselineUnit,
            );
            const sectionTitle = (icon, text) => (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                <span style={{ fontSize: 15, color: "#1a3353" }}>{icon}</span>
                <Text
                  strong
                  style={{ fontSize: 14, color: "#1a3353", letterSpacing: 0.3 }}
                >
                  {text}
                </Text>
              </div>
            );
            const fieldRow = (label, value, opts = {}) => (
              <Col
                xs={opts.span === 2 ? 24 : 12}
                sm={opts.span === 2 ? 24 : 12}
                key={label}
              >
                <div style={{ marginBottom: 14 }}>
                  <Text
                    type="secondary"
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      display: "block",
                      marginBottom: 2,
                    }}
                  >
                    {label}
                  </Text>
                  <div
                    style={{ fontSize: 13, fontWeight: 600, color: "#262626" }}
                  >
                    {value || "—"}
                  </div>
                </div>
              </Col>
            );
            return (
              <div>
                {/* Header Banner */}
                <div
                  style={{
                    background:
                      "linear-gradient(135deg, #0e1e35 0%, #1a3353 100%)",
                    padding: "24px 28px 20px",
                    paddingRight: 48,
                    borderRadius: "8px 8px 0 0",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <div>
                      <Text
                        style={{
                          color: "rgba(255,255,255,0.6)",
                          fontSize: 11,
                          textTransform: "uppercase",
                          letterSpacing: 1,
                        }}
                      >
                        Submission Details
                      </Text>
                      <div style={{ marginTop: 4 }}>
                        <Text
                          style={{
                            color: "#fff",
                            fontSize: 20,
                            fontWeight: 700,
                            letterSpacing: 0.5,
                          }}
                        >
                          {d.idNo}
                        </Text>
                      </div>
                      <Text
                        style={{
                          color: "rgba(255,255,255,0.7)",
                          fontSize: 12,
                          marginTop: 4,
                          display: "block",
                        }}
                      >
                        {d.lguCompanyName} &middot;{" "}
                        {d.dateOfDisposal
                          ? dayjs(d.dateOfDisposal).format("MMMM D, YYYY")
                          : "No date"}
                      </Text>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {renderStatusTag(d.status, d)}
                      <div style={{ marginTop: 8 }}>
                        <Text
                          style={{
                            color: "rgba(255,255,255,0.5)",
                            fontSize: 11,
                          }}
                        >
                          Submitted{" "}
                          {dayjs(d.createdAt).format("MMM D, YYYY h:mm A")}
                        </Text>
                      </div>
                    </div>
                  </div>
                </div>

                {/* The header above renders from the lean row we already have, so the
                    modal is never blank. Everything below needs the FULL record
                    (trucks, baseline, capacity), so it skeletons until that lands. */}
                {historyDetailError ? (
                  <div style={{ padding: "24px 28px" }}>
                    <Alert
                      type="error"
                      showIcon
                      message="Could not load submission details"
                      description={historyDetailError}
                    />
                  </div>
                ) : historyDetailLoading ? (
                  <div style={{ padding: "24px 28px" }}>
                    <Row gutter={16} style={{ marginBottom: 24 }}>
                      {[0, 1, 2].map((i) => (
                        <Col xs={8} key={i}>
                          <Skeleton.Input active block style={{ height: 72 }} />
                        </Col>
                      ))}
                    </Row>
                    <Skeleton active paragraph={{ rows: 6 }} />
                  </div>
                ) : (
                <div style={{ padding: "24px 28px" }}>
                  {/* Summary Stats Bar */}
                  <Row gutter={16} style={{ marginBottom: 24 }}>
                    <Col xs={8}>
                      <div
                        style={{
                          background: "#f0f5ff",
                          borderRadius: 8,
                          padding: "12px 16px",
                          border: "1px solid #d6e4ff",
                          minHeight: 72,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text
                          type="secondary"
                          style={{
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                          }}
                        >
                          Company Type
                        </Text>
                        <div style={{ marginTop: 4 }}>
                          <Tag
                            color={d.companyType === "LGU" ? "blue" : "green"}
                            style={{ margin: 0, fontWeight: 600 }}
                          >
                            {d.companyType}
                          </Tag>
                        </div>
                      </div>
                    </Col>
                    <Col xs={8}>
                      <div
                        style={{
                          background: "#f6ffed",
                          borderRadius: 8,
                          padding: "12px 16px",
                          border: "1px solid #d9f7be",
                          minHeight: 72,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text
                          type="secondary"
                          style={{
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                          }}
                        >
                          Truck Entries
                        </Text>
                        <div style={{ marginTop: 4 }}>
                          <Text
                            strong
                            style={{ fontSize: 18, color: "#52c41a" }}
                          >
                            {d.trucks?.length || 0}
                          </Text>
                        </div>
                      </div>
                    </Col>
                    <Col xs={8}>
                      <div
                        style={{
                          background: "#fff7e6",
                          borderRadius: 8,
                          padding: "12px 16px",
                          border: "1px solid #ffe7ba",
                          minHeight: 72,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text
                          type="secondary"
                          style={{
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                          }}
                        >
                          Total Volume
                        </Text>
                        <div style={{ marginTop: 4 }}>
                          <Text
                            strong
                            style={{ fontSize: 16, color: "#fa8c16" }}
                          >
                            {totalVolumeSummary}
                          </Text>
                        </div>
                      </div>
                    </Col>
                  </Row>

                  <Collapse
                    bordered={false}
                    size="small"
                    style={{ background: "transparent" }}
                    items={[
                      {
                        key: "company",
                        label: (
                          <Text strong style={{ fontSize: 13 }}>
                            <EnvironmentOutlined
                              style={{ color: "#1a3353", marginRight: 6 }}
                            />
                            Company & Disposal Information
                          </Text>
                        ),
                        children: (
                          <Row gutter={16}>
                            {fieldRow("Company / LGU Name", d.lguCompanyName)}
                            {fieldRow(
                              "Company Type",
                              <Tag
                                color={
                                  d.companyType === "LGU" ? "blue" : "green"
                                }
                                variant="filled"
                              >
                                {d.companyType}
                              </Tag>,
                            )}
                            {fieldRow("Address", d.address, { span: 2 })}
                            {fieldRow(
                              "Date of Disposal",
                              d.dateOfDisposal
                                ? dayjs(d.dateOfDisposal).format("MMMM D, YYYY")
                                : null,
                            )}
                            {fieldRow(
                              "Submission ID",
                              <Text
                                copyable
                                style={{
                                  fontSize: 12,
                                  fontFamily: "monospace",
                                }}
                              >
                                {d.submissionId || "—"}
                              </Text>,
                            )}
                          </Row>
                        ),
                      },
                      {
                        key: "baseline",
                        label: (
                          <Text strong style={{ fontSize: 13 }}>
                            <DatabaseOutlined
                              style={{ color: "#1a3353", marginRight: 6 }}
                            />
                            Baseline Data
                          </Text>
                        ),
                        children: (
                          <Row gutter={16}>
                            {fieldRow(
                              "Total Volume Accepted",
                              d.totalVolumeAccepted != null
                                ? `${d.totalVolumeAccepted.toLocaleString()} ${(d.totalVolumeAcceptedUnit || baselineUnit).replace("m3", "m³")}`
                                : null,
                            )}
                            {fieldRow(
                              "Active Cell — Residual",
                              d.activeCellResidualVolume != null
                                ? `${d.activeCellResidualVolume.toLocaleString()} ${(d.activeCellResidualUnit || baselineUnit).replace("m3", "m³")}`
                                : null,
                            )}
                            {fieldRow(
                              "Active Cell — Inert",
                              d.activeCellInertVolume != null
                                ? `${d.activeCellInertVolume.toLocaleString()} ${(d.activeCellInertUnit || baselineUnit).replace("m3", "m³")}`
                                : null,
                            )}
                            {d.acceptsHazardousWaste &&
                              fieldRow(
                                "Active Cell — Hazardous",
                                d.activeCellHazardousVolume != null
                                  ? `${d.activeCellHazardousVolume.toLocaleString()} ${(d.activeCellHazardousUnit || baselineUnit).replace("m3", "m³")}`
                                  : null,
                              )}
                            {fieldRow(
                              "Closed Cell — Residual",
                              d.closedCellResidualVolume != null
                                ? `${d.closedCellResidualVolume.toLocaleString()} ${(d.closedCellResidualUnit || baselineUnit).replace("m3", "m³")}`
                                : null,
                            )}
                            {fieldRow(
                              "Closed Cell — Inert",
                              d.closedCellInertVolume != null
                                ? `${d.closedCellInertVolume.toLocaleString()} ${(d.closedCellInertUnit || baselineUnit).replace("m3", "m³")}`
                                : null,
                            )}
                            {d.acceptsHazardousWaste &&
                              fieldRow(
                                "Closed Cell — Hazardous",
                                d.closedCellHazardousVolume != null
                                  ? `${d.closedCellHazardousVolume.toLocaleString()} ${(d.closedCellHazardousUnit || baselineUnit).replace("m3", "m³")}`
                                  : null,
                              )}
                          </Row>
                        ),
                      },
                      {
                        key: "operations",
                        label: (
                          <Text strong style={{ fontSize: 13 }}>
                            <PieChartOutlined
                              style={{ color: "#13c2c2", marginRight: 6 }}
                            />
                            Cell Capacity
                          </Text>
                        ),
                        children: (() => {
                          const fac = d.slfGenerator || {};
                          const facilityCapacity = fac.volumeCapacity || 0;
                          const baselineVol = d.totalVolumeAccepted || 0;
                          const truckVol = (d.trucks || []).reduce(
                            (s, t) => s + (t.actualVolume || 0),
                            0,
                          );
                          const filledVol = baselineVol + truckVol;
                          const pct =
                            facilityCapacity > 0
                              ? Math.min(
                                  Math.round(
                                    (filledVol / facilityCapacity) * 100,
                                  ),
                                  100,
                                )
                              : 0;
                          return (
                            <div>
                              <Row gutter={16}>
                                {fieldRow(
                                  "Current Cell Volume",
                                  d.currentCellVolume != null
                                    ? `${d.currentCellVolume.toLocaleString()} ${(d.currentCellVolumeUnit || baselineUnit).replace("m3", "m³")}`
                                    : null,
                                )}
                                {fieldRow(
                                  "Cell Status",
                                  <Tag
                                    color={
                                      d.cellStatus === "Closed"
                                        ? "red"
                                        : "green"
                                    }
                                    variant="filled"
                                  >
                                    {d.cellStatus || "Active"}
                                  </Tag>,
                                )}
                                {fieldRow(
                                  "Number of Cells",
                                  fac.numberOfCell || "—",
                                )}
                                {fieldRow(
                                  "Facility Capacity",
                                  facilityCapacity > 0
                                    ? `${facilityCapacity.toLocaleString()} m³`
                                    : "—",
                                )}
                              </Row>
                              <Divider style={{ margin: "4px 0 16px" }} />
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 24,
                                }}
                              >
                                <Progress
                                  type="dashboard"
                                  percent={pct}
                                  size={110}
                                  strokeColor={
                                    pct >= 90
                                      ? "#ff4d4f"
                                      : pct >= 70
                                        ? "#faad14"
                                        : "#52c41a"
                                  }
                                  format={() => (
                                    <div
                                      style={{
                                        textAlign: "center",
                                        lineHeight: 1.3,
                                      }}
                                    >
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
                                        filled
                                      </div>
                                    </div>
                                  )}
                                />
                                <div style={{ flex: 1 }}>
                                  <Text
                                    strong
                                    style={{
                                      fontSize: 13,
                                      display: "block",
                                      marginBottom: 8,
                                    }}
                                  >
                                    Cell Capacity Usage
                                  </Text>
                                  <Row gutter={8}>
                                    <Col xs={12}>
                                      <Text
                                        type="secondary"
                                        style={{ fontSize: 11 }}
                                      >
                                        Baseline Volume
                                      </Text>
                                      <div>
                                        <Text style={{ fontSize: 13 }}>
                                          {baselineVol > 0
                                            ? `${baselineVol.toLocaleString()} ${(d.totalVolumeAcceptedUnit || baselineUnit).replace("m3", "m³")}`
                                            : "0"}
                                        </Text>
                                      </div>
                                    </Col>
                                    <Col xs={12}>
                                      <Text
                                        type="secondary"
                                        style={{ fontSize: 11 }}
                                      >
                                        Transport & Disposal
                                      </Text>
                                      <div>
                                        <Text style={{ fontSize: 13 }}>
                                          {truckVol > 0
                                            ? `${truckVol.toLocaleString()} tons`
                                            : "0"}
                                        </Text>
                                      </div>
                                    </Col>
                                    <Col xs={12}>
                                      <Text
                                        type="secondary"
                                        style={{
                                          fontSize: 11,
                                          marginTop: 8,
                                          display: "block",
                                        }}
                                      >
                                        Total Filled
                                      </Text>
                                      <div>
                                        <Text
                                          strong
                                          style={{
                                            fontSize: 14,
                                            color: "#1a3353",
                                          }}
                                        >
                                          {filledVol > 0
                                            ? filledVol.toLocaleString()
                                            : "0"}
                                        </Text>
                                      </div>
                                    </Col>
                                    <Col xs={12}>
                                      <Text
                                        type="secondary"
                                        style={{
                                          fontSize: 11,
                                          marginTop: 8,
                                          display: "block",
                                        }}
                                      >
                                        Remaining
                                      </Text>
                                      <div>
                                        <Text
                                          strong
                                          style={{
                                            fontSize: 14,
                                            color:
                                              facilityCapacity - filledVol <= 0
                                                ? "#ff4d4f"
                                                : "#52c41a",
                                          }}
                                        >
                                          {facilityCapacity > 0
                                            ? (
                                                facilityCapacity - filledVol
                                              ).toLocaleString()
                                            : "No capacity set"}
                                        </Text>
                                      </div>
                                    </Col>
                                  </Row>
                                </div>
                              </div>
                            </div>
                          );
                        })(),
                      },
                      ...(d.accreditedHaulers?.length > 0
                        ? [
                            {
                              key: "haulers",
                              label: (
                                <Text strong style={{ fontSize: 13 }}>
                                  <TeamOutlined
                                    style={{ color: "#1a3353", marginRight: 6 }}
                                  />
                                  Accredited Haulers (
                                  {d.accreditedHaulers.length})
                                </Text>
                              ),
                              children: (() => {
                                // Helper: normalise a client entry to a plain string.
                                const clientLabel = (c) => {
                                  if (!c) return "";
                                  if (typeof c === "string") return c.trim();
                                  return (
                                    c.clientName ||
                                    c.name ||
                                    c.company ||
                                    JSON.stringify(c)
                                  ).trim();
                                };
                                // Flatten each hauler into a flat row for the
                                // main table, carrying its vehicles for expansion.
                                const haulerRows = d.accreditedHaulers.map((h, i) => {
                                  const rawClients = Array.isArray(h.privateSectorClients)
                                    ? h.privateSectorClients
                                    : h.privateSectorClients
                                      ? [h.privateSectorClients]
                                      : [];
                                  const clientStr =
                                    rawClients.length > 0
                                      ? rawClients.map(clientLabel).filter(Boolean).join(", ")
                                      : "—";
                                  const vehicles =
                                    h.vehicles?.length > 0
                                      ? h.vehicles
                                      : h.plateNumber || h.vehicleType || h.capacity != null
                                        ? [{
                                            plateNumber: h.plateNumber,
                                            vehicleType: h.vehicleType,
                                            capacity: h.capacity,
                                            capacityUnit: h.capacityUnit,
                                          }]
                                        : [];
                                  return { ...h, _idx: i, clientStr, vehicles };
                                });
                                return (
                                  <Table
                                    size="small"
                                    rowKey="_idx"
                                    pagination={false}
                                    dataSource={haulerRows}
                                    scroll={{ x: 640 }}
                                    expandable={{
                                      expandedRowRender: (row) =>
                                        row.vehicles.length > 0 ? (
                                          <Table
                                            size="small"
                                            rowKey={(_, vi) => vi}
                                            pagination={false}
                                            dataSource={row.vehicles}
                                            style={{ margin: "4px 0" }}
                                            columns={[
                                              { title: "#", width: 40, render: (_, __, vi) => vi + 1 },
                                              { title: "Plate Number", dataIndex: "plateNumber", render: (v) => v || "—" },
                                              { title: "Vehicle Type", dataIndex: "vehicleType", render: (v) => v || "—" },
                                              {
                                                title: "Capacity",
                                                render: (_, v) =>
                                                  v.capacity != null
                                                    ? `${v.capacity} ${(v.capacityUnit || baselineUnit).replace("m3", "m³")}`
                                                    : "—",
                                              },
                                            ]}
                                          />
                                        ) : null,
                                      rowExpandable: (row) => row.vehicles.length > 0,
                                    }}
                                    columns={[
                                      {
                                        title: "#",
                                        dataIndex: "_idx",
                                        width: 44,
                                        render: (v) => v + 1,
                                      },
                                      {
                                        title: "Hauler Name",
                                        dataIndex: "haulerName",
                                        render: (v) => <Text strong style={{ fontSize: 12 }}>{v || "Unnamed"}</Text>,
                                      },
                                      {
                                        // #6: Hauler Clients immediately after Hauler Name.
                                        title: "Hauler Clients",
                                        dataIndex: "clientStr",
                                        render: (v) => (
                                          <Text style={{ fontSize: 12, whiteSpace: "normal", wordBreak: "break-word" }}>{v || "—"}</Text>
                                        ),
                                      },
                                      {
                                        title: "No. of Trucks",
                                        dataIndex: "numberOfTrucks",
                                        width: 100,
                                        align: "center",
                                        render: (v) => v ?? "—",
                                      },
                                      {
                                        title: "Office Address",
                                        dataIndex: "officeAddress",
                                        render: (v) => <Text style={{ fontSize: 12 }}>{v || "—"}</Text>,
                                      },
                                    ]}
                                  />
                                );
                              })(),
                            },
                          ]
                        : []),
                      {
                        key: "transport",
                        label: (
                          <Text strong style={{ fontSize: 13 }}>
                            <CarOutlined
                              style={{ color: "#1a3353", marginRight: 6 }}
                            />
                            Transport & Disposal ({wasteEntries.length} waste
                            entr{wasteEntries.length === 1 ? "y" : "ies"} across{" "}
                            {(d.trucks || []).length} truck
                            {(d.trucks || []).length === 1 ? "" : "s"})
                          </Text>
                        ),
                        children:
                          wasteEntries.length > 0 ? (
                            <Table
                              dataSource={wasteEntries}
                              rowKey="key"
                              size="small"
                              className="slf-slim-scroll"
                              // Natural width rather than a fixed 900px: several
                              // columns here declare no width, so a fixed x pinched
                              // them (HW Code worst of all) instead of letting the
                              // table scroll inside the modal.
                              scroll={{ x: "max-content" }}
                              pagination={
                                wasteEntries.length > 10
                                  ? {
                                      pageSize: 10,
                                      size: "small",
                                      showSizeChanger: true,
                                      pageSizeOptions: [10, 20, 50, 100],
                                      showTotal: (total) =>
                                        `${total} waste entr${total === 1 ? "y" : "ies"}`,
                                    }
                                  : false
                              }
                              columns={[
                                {
                                  title: "#",
                                  key: "idx",
                                  width: 40,
                                  render: (_, __, i) => (
                                    <Text type="secondary">{i + 1}</Text>
                                  ),
                                },
                                {
                                  title: "Date",
                                  key: "date",
                                  width: 110,
                                  render: (_, e) =>
                                    e.date
                                      ? dayjs(e.date).format("MMM D, YYYY")
                                      : "—",
                                },
                                {
                                  title: "Ticket No.",
                                  dataIndex: "ticketNo",
                                  key: "ticket",
                                  render: (v) => v || "—",
                                },
                                {
                                  title: "Hauler",
                                  dataIndex: "hauler",
                                  key: "hauler",
                                  render: (v) => <Text strong>{v || "—"}</Text>,
                                },
                                {
                                  title: "Plate No.",
                                  dataIndex: "plateNumber",
                                  key: "plate",
                                  render: (v) => v || "—",
                                },
                                {
                                  title: "Waste Type",
                                  dataIndex: "wasteType",
                                  key: "waste",
                                  render: (v) =>
                                    v ? (
                                      <Tag
                                        color={
                                          v === "Residual" ? "blue" : "volcano"
                                        }
                                        variant="filled"
                                      >
                                        {v}
                                      </Tag>
                                    ) : (
                                      "—"
                                    ),
                                },
                                {
                                  title: "Volume",
                                  key: "vol",
                                  align: "right",
                                  width: 90,
                                  render: (_, e) =>
                                    e.volume != null ? (
                                      <Text strong style={{ color: "#52c41a" }}>
                                        {e.volume.toLocaleString(undefined, {
                                          maximumFractionDigits: 2,
                                        })}
                                      </Text>
                                    ) : (
                                      "—"
                                    ),
                                },
                                {
                                  // Unit kept in its own column so a volume is never
                                  // read (or copied out) without its unit.
                                  title: "Unit",
                                  dataIndex: "unit",
                                  key: "unit",
                                  width: 70,
                                  render: (v) => v || "—",
                                },
                                {
                                  title: "Cell",
                                  dataIndex: "cell",
                                  key: "cell",
                                  width: 110,
                                  render: (v) =>
                                    v || (
                                      <Text type="secondary">Unplaced</Text>
                                    ),
                                },
                                {
                                  title: "HW Code",
                                  key: "hw",
                                  // Bounded + tooltipped, like the admin-side copy:
                                  // an unbounded joined list of codes overflowed
                                  // the column and the modal.
                                  width: 150,
                                  render: (_, e) => {
                                    const codes = (e.hazWasteCodes || []).filter(Boolean);
                                    if (!codes.length) return <Text type="secondary">—</Text>;
                                    return (
                                      <Tooltip title={codes.join(", ")}>
                                        <Space size={[2, 2]} wrap style={{ maxWidth: 140 }}>
                                          {codes.slice(0, 2).map((code) => (
                                            <Tag
                                              key={code}
                                              color="volcano"
                                              variant="filled"
                                              style={{ margin: 0, fontSize: 11 }}
                                            >
                                              {code}
                                            </Tag>
                                          ))}
                                          {codes.length > 2 && (
                                            <Tag variant="filled" style={{ margin: 0, fontSize: 11 }}>
                                              +{codes.length - 2}
                                            </Tag>
                                          )}
                                        </Space>
                                      </Tooltip>
                                    );
                                  },
                                },
                              ]}
                            />
                          ) : (
                            <div
                              style={{ textAlign: "center", padding: "20px 0" }}
                            >
                              <Text type="secondary">
                                No transport entries recorded.
                              </Text>
                            </div>
                          ),
                      },
                    ]}
                  />

                  {/* Revert Info Banner */}
                  {d.status === "reverted" && d.revertReason && (
                    <div
                      style={{
                        background: "#fff2e8",
                        border: "1px solid #ffbb96",
                        borderRadius: 8,
                        padding: "12px 16px",
                        marginTop: 20,
                      }}
                    >
                      <Space align="start">
                        <UndoOutlined
                          style={{ color: "#fa541c", marginTop: 2 }}
                        />
                        <div>
                          <Text
                            strong
                            style={{ color: "#fa541c", fontSize: 13 }}
                          >
                            Reverted by Administrator
                          </Text>
                          <div style={{ marginTop: 4 }}>
                            <Text style={{ fontSize: 12, color: "#8c8c8c" }}>
                              Reason: {d.revertReason}
                            </Text>
                          </div>
                          {d.revertedAt && (
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {dayjs(d.revertedAt).format("MMM D, YYYY h:mm A")}
                            </Text>
                          )}
                        </div>
                      </Space>
                    </div>
                  )}
                </div>
                )}
              </div>
            );
          })()}
      </Modal>

      {/* ── #1: Open-Cell Picker — a compact selectable TABLE of the valid open
             cells (only open/compatible cells appear, so every row is selectable).
             Selecting a row places THIS vehicle's waste into that cell. ── */}
      <Modal
        title={
          <Space>
            <ContainerOutlined style={{ color: "#722ed1" }} /> Select an Open Disposal Cell
          </Space>
        }
        open={!!cellPicker}
        onCancel={() => setCellPicker(null)}
        footer={<Button onClick={() => setCellPicker(null)}>Close</Button>}
        width={880}
        destroyOnHidden
      >
        <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
          Only cells open for disposal and compatible with the selected waste type are
          listed. Click a row to place this vehicle&apos;s waste there.
        </Text>
        <Table
          size="small"
          rowKey="value"
          dataSource={cellPicker?.options || []}
          pagination={
            (cellPicker?.options || []).length > 8
              ? { pageSize: 8, size: "small", showSizeChanger: false }
              : false
          }
          scroll={{ x: 760 }}
          onRow={(record) => ({
            onClick: () => applyPickedCell(record),
            style: { cursor: "pointer" },
          })}
          rowClassName={(record) =>
            record.value === truckDraft.vehicles?.[cellPicker?.vi]?.cellName
              ? "ant-table-row-selected"
              : ""
          }
          locale={{ emptyText: <Empty description="No open cells available." /> }}
          columns={[
            {
              title: "Select",
              key: "select",
              width: 64,
              align: "center",
              render: (_, record) => (
                <Radio
                  checked={record.value === truckDraft.vehicles?.[cellPicker?.vi]?.cellName}
                  onClick={(e) => {
                    e.stopPropagation();
                    applyPickedCell(record);
                  }}
                />
              ),
            },
            {
              title: "Cell Name",
              dataIndex: "cellName",
              key: "cellName",
              width: 130,
              ellipsis: true,
              render: (v, r) => <Text strong>{v || r.value}</Text>,
            },
            {
              title: "Facility",
              dataIndex: "facility",
              key: "facility",
              width: 150,
              ellipsis: true,
              render: (v) => v || "—",
            },
            {
              title: "Waste Type",
              dataIndex: "cellType",
              key: "cellType",
              width: 120,
              render: (v) => (
                <Tag color={/haz/i.test(v || "") ? "volcano" : "geekblue"}>{v || "Residual"}</Tag>
              ),
            },
            {
              title: "Status",
              dataIndex: "status",
              key: "status",
              width: 110,
              render: (v) => <Tag color="green">{v || "Active Cell"}</Tag>,
            },
            {
              title: "Capacity",
              key: "capacity",
              width: 110,
              align: "right",
              render: (_, r) =>
                r.capacity != null
                  ? `${Number(r.capacity).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${r.unit}`
                  : "—",
            },
            {
              title: "Used Volume",
              key: "used",
              width: 110,
              align: "right",
              render: (_, r) =>
                r.used != null
                  ? `${Number(r.used).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${r.unit}`
                  : "—",
            },
            {
              title: "Remaining",
              key: "remaining",
              width: 120,
              align: "right",
              render: (_, r) =>
                r.remaining != null ? (
                  <Text strong style={{ color: "#52c41a" }}>
                    {`${Number(r.remaining).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${r.unit}`}
                  </Text>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      </Modal>

      {/* ── Review Submission Modal ── */}
      <Modal
        title={
          <Space>
            <EyeOutlined style={{ color: "#1a3353" }} />
            <span>
              {editingRevertedId ? "Review Resubmission" : "Review Submission"}
            </span>
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
        footer={
          editingRevertedId ? undefined : (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              {/* Secondary "save for later" actions, grouped together on the left */}
              <Space size={8} wrap>
                <Button
                  key="draft"
                  icon={<SaveOutlined />}
                  loading={savingDraft}
                  onClick={handleSaveDraft}
                >
                  Save as Draft
                </Button>
                <Button
                  key="schedule"
                  icon={<ClockCircleOutlined />}
                  onClick={openScheduleModal}
                >
                  Schedule
                </Button>
              </Space>
              {/* Primary flow actions on the right */}
              <Space size={8} wrap>
                <Button key="back" onClick={() => setReviewModalOpen(false)}>
                  Go Back
                </Button>
                <Button
                  key="submit"
                  type="primary"
                  className="slf-primary-btn"
                  loading={loading}
                  icon={<SendOutlined />}
                  onClick={handleConfirmSubmit}
                >
                  Confirm & Submit
                </Button>
              </Space>
            </div>
          )
        }
        // Widened for the Transport Entries table. Capped at 96vw so it still
        // fits a laptop screen and never forces the page itself to scroll
        // sideways — the table handles its own overflow.
        width={1100}
        style={{ maxWidth: "96vw", top: 24 }}
        classNames={{ body: "slf-slim-scroll" }}
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
          <CheckCircleOutlined style={{ color: "#52c41a", marginRight: 8 }} />
          <Text style={{ color: "#389e0d" }}>
            Please review all information below before confirming your
            submission.
          </Text>
        </div>
        {editingRevertedId && (
          <div style={{ marginBottom: 16 }}>
            <Text
              strong
              style={{ display: "block", marginBottom: 6, fontSize: 13 }}
            >
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
                <Row gutter={[12, 8]}>
                  {(() => {
                    // These names are resolved by looking a stored PSGC CODE up in
                    // the cascading option arrays. Those arrays are repopulated as
                    // the user picks region → province → municipality, so after a
                    // baseline edit they can be empty and every lookup returns
                    // undefined — which rendered "—" even though the values were
                    // still in the form. Fall back to the stored value so an
                    // already-recorded address always shows something real.
                    const resolve = (list, field) => {
                      const stored = companyForm.getFieldValue(field);
                      if (!stored) return "";
                      const hit = (Array.isArray(list) ? list : []).find(
                        (item) => item.code === stored,
                      );
                      // A stored value that is not a numeric PSGC code is already
                      // a readable name (older records stored names directly).
                      return hit?.name || (/^\d+$/.test(String(stored)) ? "" : stored);
                    };
                    return [
                      { label: "Company Name", value: companyForm.getFieldValue("lguCompanyName") },
                      { label: "Region", value: resolve(regions, "companyRegion") },
                      { label: "Province", value: resolve(provinces, "companyProvince") },
                      { label: "City/Municipality", value: resolve(municipalities, "companyMunicipality") },
                      { label: "Barangay", value: resolve(barangays, "companyBarangay") },
                    ];
                  })().map(({ label, value }) => (
                    <Col xs={24} sm={12} key={label}>
                      <div style={{ marginBottom: 2 }}>
                        <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 3 }}>{label}</Text>
                        <Input value={value || "—"} readOnly style={{ background: "#fafafa", cursor: "default", color: "#222" }} />
                      </div>
                    </Col>
                  ))}
                </Row>
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
                <Row gutter={[12, 8]}>
                  {[
                    {
                      label: "Date of Disposal",
                      value: entryForm.getFieldValue("dateOfDisposal")
                        ? dayjs(entryForm.getFieldValue("dateOfDisposal")).format("MM/DD/YYYY")
                        : "—",
                    },
                    { label: "LGU/Company Name", value: companyForm.getFieldValue("lguCompanyName") },
                    {
                      label: "Company Type",
                      value: slfInfo
                        ? (slfInfo.ownership || "").toLowerCase().includes("private") ? "Private" : "LGU"
                        : "—",
                    },
                    { label: "Address", value: entryForm.getFieldValue("address") },
                  ].map(({ label, value }) => (
                    <Col xs={24} sm={12} key={label}>
                      <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 3 }}>{label}</Text>
                      <Input value={value || "—"} readOnly style={{ background: "#fafafa", cursor: "default", color: "#222" }} />
                    </Col>
                  ))}
                </Row>
              ),
            },
            {
              key: "baseline",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <DatabaseOutlined /> Baseline Data
                  {!baselineSaved && (
                    <Tag color="volcano" style={{ marginLeft: 8, fontSize: 10 }}>
                      First-time Entry
                    </Tag>
                  )}
                </Text>
              ),
              children: (
                <>
                  {!baselineSaved && (
                    <div style={{ background: "#fff7e6", border: "1px solid #ffe58f", borderRadius: 6, padding: "8px 14px", marginBottom: 12 }}>
                      <InfoCircleOutlined style={{ color: "#fa8c16", marginRight: 8 }} />
                      <Text style={{ color: "#ad6800", fontSize: 12 }}>
                        This baseline data will be{" "}
                        <Text strong style={{ color: "#ad6800" }}>locked after submission</Text>{" "}
                        and cannot be changed without requesting an update. Please verify all details carefully.
                      </Text>
                    </div>
                  )}
                  <Row gutter={[12, 8]} style={{ marginBottom: 12 }}>
                    <Col xs={24} sm={12}>
                      <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 3 }}>Total Volume Accepted</Text>
                      <Input
                        value={
                          baselineForm.getFieldValue("totalVolumeAccepted") != null
                            ? `${Number(baselineForm.getFieldValue("totalVolumeAccepted")).toLocaleString()} ${(baselineForm.getFieldValue("totalVolumeAcceptedUnit") || baselineUnit).replace("m3", "m³")}`
                            : "—"
                        }
                        readOnly
                        style={{ background: "#fafafa", cursor: "default", color: "#222" }}
                      />
                    </Col>
                  </Row>
                  {activeCellEntries.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 6 }}>Active Cell Entries</Text>
                      {activeCellEntries.map((e, i) => (
                        <Row gutter={[8, 4]} key={e.key ?? i} style={{ marginBottom: 6, background: "#f9f9f9", borderRadius: 6, padding: "6px 8px" }}>
                          <Col xs={24} sm={8}>
                            <Text type="secondary" style={{ fontSize: 10 }}>Cell Name</Text>
                            <Input size="small" value={e.cellName || "—"} readOnly style={{ background: "#fafafa", cursor: "default" }} />
                          </Col>
                          <Col xs={24} sm={8}>
                            <Text type="secondary" style={{ fontSize: 10 }}>Waste Type</Text>
                            <Input size="small" value={e.wasteType || "—"} readOnly style={{ background: "#fafafa", cursor: "default" }} />
                          </Col>
                          <Col xs={24} sm={8}>
                            <Text type="secondary" style={{ fontSize: 10 }}>Volume</Text>
                            <Input size="small" value={e.volume != null ? `${e.volume} ${normalizeUnitLabel(e.unit || baselineUnit || baselineUnit)}` : "—"} readOnly style={{ background: "#fafafa", cursor: "default" }} />
                          </Col>
                        </Row>
                      ))}
                    </div>
                  )}
                  {closedCellEntries.length > 0 && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 6 }}>Closed Cell Entries</Text>
                      {closedCellEntries.map((e, i) => (
                        <Row gutter={[8, 4]} key={e.key ?? i} style={{ marginBottom: 6, background: "#f9f9f9", borderRadius: 6, padding: "6px 8px" }}>
                          <Col xs={24} sm={8}>
                            <Text type="secondary" style={{ fontSize: 10 }}>Cell Name</Text>
                            <Input size="small" value={e.cellName || "—"} readOnly style={{ background: "#fafafa", cursor: "default" }} />
                          </Col>
                          <Col xs={24} sm={8}>
                            <Text type="secondary" style={{ fontSize: 10 }}>Waste Type</Text>
                            <Input size="small" value={e.wasteType || "—"} readOnly style={{ background: "#fafafa", cursor: "default" }} />
                          </Col>
                          <Col xs={24} sm={8}>
                            <Text type="secondary" style={{ fontSize: 10 }}>Volume</Text>
                            <Input size="small" value={e.volume != null ? `${e.volume} ${normalizeUnitLabel(e.unit || baselineUnit || baselineUnit)}` : "—"} readOnly style={{ background: "#fafafa", cursor: "default" }} />
                          </Col>
                        </Row>
                      ))}
                    </div>
                  )}
                </>
              ),
            },
            ...(haulers.length > 0
              ? [
                  {
                    key: "haulers",
                    label: (
                      <Text strong style={{ color: "#1a3353" }}>
                        <TeamOutlined /> Accredited Haulers ({haulers.length})
                      </Text>
                    ),
                    children: (
                      <div>
                        {haulers.map((h, hi) => (
                          <div key={h.key ?? hi} style={{ background: "#f9f9f9", borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
                            <Text strong style={{ fontSize: 12, color: "#1a3353", display: "block", marginBottom: 8 }}>
                              Hauler {hi + 1}
                            </Text>
                            <Row gutter={[8, 6]}>
                              <Col xs={24} sm={12}>
                                <Text type="secondary" style={{ fontSize: 10 }}>Hauler Name</Text>
                                <Input size="small" value={h.haulerName || "—"} readOnly style={{ background: "#fafafa", cursor: "default" }} />
                              </Col>
                              {/* #6: Hauler Clients shown immediately after Hauler Name. */}
                              <Col xs={24} sm={12}>
                                <Text type="secondary" style={{ fontSize: 10 }}>Hauler Clients</Text>
                                <Input
                                  size="small"
                                  value={
                                    (h.privateSectorClients || []).length > 0
                                      ? (h.privateSectorClients || []).map((c) => (typeof c === "object" ? c.clientName : c)).join(", ")
                                      : "—"
                                  }
                                  readOnly
                                  style={{ background: "#fafafa", cursor: "default" }}
                                />
                              </Col>
                              <Col xs={24} sm={12}>
                                <Text type="secondary" style={{ fontSize: 10 }}>Number of Trucks</Text>
                                <Input size="small" value={h.numberOfTrucks ?? "—"} readOnly style={{ background: "#fafafa", cursor: "default" }} />
                              </Col>
                              {(h.vehicles || []).map((v, vi) => (
                                <Col xs={24} key={vi}>
                                  <Text type="secondary" style={{ fontSize: 10 }}>Vehicle {vi + 1}</Text>
                                  <Input size="small" value={`${v.plateNumber || "N/A"} — ${v.vehicleType || "N/A"} (${v.capacity ?? "—"} ${v.capacityUnit || baselineUnit})`} readOnly style={{ background: "#fafafa", cursor: "default" }} />
                                </Col>
                              ))}
                            </Row>
                          </div>
                        ))}
                      </div>
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
              // One ROW per transport entry instead of a stacked read-only card
              // each. The card layout cost ~7 inputs of vertical space per entry,
              // so a submission with a dozen trucks was unreviewable; a table puts
              // every entry on one line and keeps the header in view while
              // scrolling. Same fields as before, plus the Disposal Cell — the
              // placement was previously not shown on the review screen at all.
              children: (() => {
                const unitOf = (u) => String(u || baselineUnit).replace("m3", "m³");
                const rows = trucks.map((t, ti) => {
                  const vehs = t.vehicles || [];
                  const plate =
                    vehs.length > 1
                      ? vehs.map((v) => v.plateNumber).filter(Boolean).join(", ") || t.plateNumber || "—"
                      : vehs[0]?.plateNumber || t.plateNumber || "—";
                  const capacity =
                    vehs.length > 1
                      ? vehs
                          .filter((v) => v.capacity != null)
                          .map((v) => `${v.capacity} ${unitOf(v.capacityUnit)}`)
                          .join(", ") || "—"
                      : (() => {
                          const cap = vehs[0]?.capacity ?? t.truckCapacity;
                          return cap != null
                            ? `${cap} ${unitOf(vehs[0]?.capacityUnit || t.truckCapacityUnit)}`
                            : "—";
                        })();
                  const cell =
                    vehs.length > 1
                      ? [...new Set(vehs.map((v) => v.cellName).filter(Boolean))].join(", ") ||
                        t.cellName ||
                        "—"
                      : vehs[0]?.cellName || t.cellName || "—";
                  return {
                    key: t.key ?? ti,
                    no: ti + 1,
                    ticket: t.disposalTicketNo || "—",
                    hauler: t.hauler || "—",
                    plate,
                    capacity,
                    volume:
                      t.actualVolume != null
                        ? `${t.actualVolume} ${unitOf(t.actualVolumeUnit)}`
                        : "—",
                    wasteType: t.wasteType || "—",
                    cell,
                    hazCode: Array.isArray(t.hazWasteCode)
                      ? t.hazWasteCode.join(", ")
                      : t.hazWasteCode || "",
                  };
                });
                // Only shown when at least one entry actually carries codes, so a
                // residual-only submission keeps the table narrow.
                const showHazCode = rows.some((r) => r.hazCode);
                // Long free-text values are ellipsised with the full value in a
                // tooltip rather than wrapping and breaking row alignment.
                const textCell = (value) => (
                  <Text
                    style={{ fontSize: 12 }}
                    ellipsis={{ tooltip: value !== "—" ? value : undefined }}
                  >
                    {value}
                  </Text>
                );
                return (
                  <Table
                    size="small"
                    className="slf-slim-scroll"
                    dataSource={rows}
                    rowKey="key"
                    sticky
                    pagination={
                      rows.length > 10
                        ? { pageSize: 10, size: "small", showSizeChanger: false }
                        : false
                    }
                    scroll={{ x: "max-content", y: rows.length > 8 ? 360 : undefined }}
                    columns={[
                      { title: "#", dataIndex: "no", width: 44, fixed: "left", render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
                      { title: "Ticket No.", dataIndex: "ticket", width: 130, render: textCell },
                      { title: "Hauler", dataIndex: "hauler", width: 160, render: textCell },
                      { title: "Plate No.", dataIndex: "plate", width: 130, render: textCell },
                      { title: "Capacity", dataIndex: "capacity", width: 120, align: "right", render: textCell },
                      { title: "Volume", dataIndex: "volume", width: 120, align: "right", render: textCell },
                      {
                        title: "Waste Type",
                        dataIndex: "wasteType",
                        width: 150,
                        render: (value) => (
                          <Tag
                            color={/haz/i.test(value) ? "volcano" : "green"}
                            style={{ fontSize: 11, marginInlineEnd: 0 }}
                          >
                            {value}
                          </Tag>
                        ),
                      },
                      {
                        title: "Disposal Cell",
                        dataIndex: "cell",
                        width: 130,
                        render: (value) =>
                          value === "—" ? (
                            <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
                          ) : (
                            <Tag color="purple" style={{ fontSize: 11, marginInlineEnd: 0 }}>{value}</Tag>
                          ),
                      },
                      ...(showHazCode
                        ? [{ title: "Haz. Code", dataIndex: "hazCode", width: 120, render: (v) => textCell(v || "—") }]
                        : []),
                    ]}
                  />
                );
              })(),
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
          <Text strong>{SUPPORT_EMAIL}</Text> for follow-up.
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
            href={SUPPORT_MAILTO}
            target="_blank"
            style={{ padding: 0 }}
          >
            Email {SUPPORT_EMAIL}
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
        footer={
          <Button onClick={() => setProfileModalOpen(false)}>Close</Button>
        }
        width={700}
        destroyOnHidden
      >
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <Avatar
            size={72}
            style={{
              background: "linear-gradient(135deg, #1a3353, #2d5f8a)",
              fontSize: 28,
              marginBottom: 10,
            }}
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
          <Descriptions.Item label="Username">
            {portalUser?.username || portalUser?.email?.split("@")?.[0] || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="Email">
            {portalUser?.email || "—"}
          </Descriptions.Item>
          {portalUser?.officeEmail && (
            <Descriptions.Item label="Office Email">
              {portalUser.officeEmail}
            </Descriptions.Item>
          )}
          {portalUser?.pcoEmail && (
            <Descriptions.Item label="PCO Email">
              {portalUser.pcoEmail}
            </Descriptions.Item>
          )}
          <Descriptions.Item label="Contact No.">
            {portalUser?.contactNumber || "—"}
          </Descriptions.Item>
          {portalUser?.companyName && (
            <Descriptions.Item label="Company">
              {portalUser.companyName}
            </Descriptions.Item>
          )}
          <Descriptions.Item label="Assigned SLF">
            {Array.isArray(portalUser?.assignedSlfName) &&
            portalUser.assignedSlfName.length > 0 ? (
              portalUser.assignedSlfName.map((name, i) => (
                <Tag key={i} color="blue" style={{ marginBottom: 2 }}>
                  {name}
                </Tag>
              ))
            ) : portalUser?.assignedSlfName ? (
              <Tag color="blue">{portalUser.assignedSlfName}</Tag>
            ) : (
              "—"
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Account Status">
            <Tag
              color={
                portalUser?.status === "approved"
                  ? "green"
                  : portalUser?.status === "pending"
                    ? "orange"
                    : "red"
              }
            >
              {portalUser?.status?.charAt(0).toUpperCase() +
                portalUser?.status?.slice(1) || "—"}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Email Verified">
            {portalUser?.isVerified ? (
              <Tag color="green">Verified</Tag>
            ) : (
              <Tag color="red">Not Verified</Tag>
            )}
          </Descriptions.Item>
        </Descriptions>
        <Divider orientation="left" plain>
          Activity Location
        </Divider>
        <Card
          size="small"
          style={{ borderRadius: 8, background: "#f6ffed", borderColor: "#b7eb8f" }}
        >
          <Space align="start" style={{ width: "100%", justifyContent: "space-between" }}>
            <Space align="start">
              <EnvironmentOutlined style={{ color: "#52c41a", fontSize: 18, marginTop: 2 }} />
              <div>
                <Text strong style={{ fontSize: 13 }}>Share my location</Text>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Allow EMB Region III to trace your portal activity location.
                    {locationSharing && locationLabel
                      ? ` Last shared: ${locationLabel}.`
                      : ""}
                  </Text>
                </div>
              </div>
            </Space>
            <Checkbox
              checked={locationSharing}
              disabled={locationBusy}
              onChange={(e) => handleLocationSharingToggle(e.target.checked)}
            >
              {locationBusy ? "Saving..." : locationSharing ? "On" : "Off"}
            </Checkbox>
          </Space>
        </Card>
        <Divider orientation="left" plain>
          Account Credentials
        </Divider>
        <Alert
          type={portalCredentialSelfServiceEnabled ? "info" : "warning"}
          showIcon
          style={{ borderRadius: 8 }}
          message={
            portalCredentialSelfServiceEnabled
              ? "Credential updates are available before login."
              : "Credential self-service is disabled."
          }
          description={
            portalCredentialSelfServiceEnabled
              ? "Log out and use Update credentials on the login page. A verification code will be sent to your registered email before changes are saved."
              : "Please contact the administrator if you need to change your username or password."
          }
        />
      </Modal>

      {/* ── Admin Messages Floating Button ──
          Styling lives in SLFPortal.css (.slf-msg-fab) rather than inline, so the
          breakpoints can collapse it to a circle the way the VERA launcher does.
          Inline styles would have won over any media query. */}
      <Button
        type="primary"
        className="slf-msg-fab"
        icon={<MessageOutlined />}
        // The label is dropped on a phone, so the accessible name has to come from
        // somewhere else or the control becomes an unlabelled icon.
        aria-label="Messages from admin"
        onClick={() => {
          setMessageDrawerOpen(true);
          if (supportTickets.length === 0) fetchSupportTickets();
          markPortalNotificationsRead("messages");
        }}
      >
        <span className="slf-msg-fab-label">Messages</span>
        {messageUnreadCount > 0 && (
          <Badge className="slf-msg-fab-badge" count={messageUnreadCount} size="small" />
        )}
      </Button>

      {/* Support & FAQ floating button retired — VERA (the floating chatbot in
          index.jsx) now handles help/FAQ and launches the support ticket flow via
          its quick actions. The support drawer below is opened from VERA. */}

      {/* ── Admin Messages Popup ── */}
      <Modal
        title={<Space><MessageOutlined /> Messages from Admin</Space>}
        open={messageDrawerOpen}
        onCancel={() => setMessageDrawerOpen(false)}
        footer={null}
        centered
        width={isMobile ? "96%" : 620}
        styles={{ body: { padding: 16 } }}
      >
        {supportLoading ? (
          <div style={{ textAlign: "center", padding: 40 }}><Spin /></div>
        ) : adminMessages.length === 0 ? (
          <Empty description="No admin messages yet" />
        ) : (
          <List
            dataSource={adminMessages}
            renderItem={(thread) => (
              <List.Item
                style={{ cursor: "pointer", padding: "12px 0" }}
                onClick={() => setSupportDetailModal(thread)}
              >
                <List.Item.Meta
                  avatar={<Avatar icon={<MessageOutlined />} style={{ background: "#1677ff" }} />}
                  title={
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <Text strong style={{ fontSize: 13 }}>{thread.subject}</Text>
                      <Tag color={thread.status === "resolved" ? "green" : thread.status === "closed" ? "default" : "blue"}>
                        {thread.status?.replace("_", " ").toUpperCase()}
                      </Tag>
                    </div>
                  }
                  description={
                    <Space direction="vertical" size={2}>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {thread.ticketNo} &middot; {dayjs(thread.updatedAt || thread.createdAt).format("MMM D, YYYY h:mm A")}
                      </Text>
                      <Text ellipsis style={{ maxWidth: 420, fontSize: 12 }}>{thread.message}</Text>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Modal>

      {/* ── Support Popup ── */}
      <Modal
        title={
          <div className="slf-support-modal-title">
            <div className="slf-support-modal-heading">
              <span className="slf-support-modal-icon"><MessageOutlined /></span>
              <div>
                <div className="slf-support-modal-title-text">Support Tickets</div>
                <Text type="secondary" className="slf-support-modal-subtitle">
                  Open a ticket and track every request in one place. For quick answers, ask VERA.
                </Text>
              </div>
            </div>
          </div>
        }
        open={supportDrawerOpen}
        onCancel={() => setSupportDrawerOpen(false)}
        footer={null}
        centered
        // 760px forced the ticket table into a horizontal scroll on every
        // desktop width. `min()` takes the available viewport when the screen is
        // smaller than the cap, so the modal grows into the space it has without
        // ever overflowing — and the mobile branch is unchanged.
        width={isMobile ? "96%" : "min(1180px, 94vw)"}
        styles={{ body: { padding: 0 } }}
      >
        <div className="slf-support-shell">
          {/* <div className="slf-support-hero">
            <div>
              <Text className="slf-support-hero-kicker">EMB Region III Portal Help Desk</Text>
              <div className="slf-support-hero-title">Direct support for filing, updates, and account issues</div>
              <Text className="slf-support-hero-copy">
                Open a ticket for anything that needs the team. For quick how-to answers, ask VERA — the floating assistant.
              </Text>
            </div>
            <div className="slf-support-hero-stats">
              <div className="slf-support-stat-card">
                <span className="slf-support-stat-icon slf-support-stat-icon-blue"><ProfileOutlined /></span>
                <div>
                  <div className="slf-support-stat-value">{supportTickets.length}</div>
                  <div className="slf-support-stat-label">Your tickets</div>
                </div>
              </div>
              <div className="slf-support-stat-card">
                <span className="slf-support-stat-icon slf-support-stat-icon-red"><MessageOutlined /></span>
                <div>
                  <div className="slf-support-stat-value">{supportUnreadCount}</div>
                  <div className="slf-support-stat-label">Unread updates</div>
                </div>
              </div>
            </div>
          </div> */}
          <Tabs
          activeKey={resolvedSupportTab}
          onChange={setSupportTab}
          className="slf-support-tabs"
          items={[
            {
              key: "new-ticket",
              label: (
                <span className="slf-support-tab-label">
                  <span className="slf-support-tab-icon slf-support-tab-icon-green"><SendOutlined /></span>
                  New Ticket
                </span>
              ),
              children: (
                <div className="slf-support-pane">
                  <div className="slf-support-grid">
                   
                    <Form
                  form={supportForm}
                  layout="vertical"
                  requiredMark={false}
                  onFinish={handleSubmitTicket}
                  className="slf-support-form"
                  initialValues={{ category: "Technical Issue", priority: "Medium" }}
                >
                  <div className="slf-support-form-header">
                    <div className="slf-support-section-title">Create Support Ticket</div>
                    <Text type="secondary">Your ticket will appear immediately in My Tickets after submission.</Text>
                  </div>
                  <Row gutter={12}>
                    <Col xs={24} md={14}>
                  <Form.Item
                    name="category"
                    label="Category"
                    rules={[{ required: true, message: "Select a category" }]}
                  >
                    <Select
                      placeholder="Select category"
                      options={SUPPORT_CATEGORY_OPTIONS}
                    />
                  </Form.Item>
                    </Col>
                    <Col xs={24} md={10}>
                  <Form.Item
                    name="priority"
                    label="Priority"
                    rules={[{ required: true, message: "Select a priority" }]}
                  >
                    <Select
                      placeholder="Select priority"
                      options={SUPPORT_PRIORITY_OPTIONS}
                    />
                  </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item
                    name="subject"
                    label="Subject"
                    rules={[{ required: true, message: "Enter a subject" }]}
                  >
                    <Input placeholder="Brief summary of the issue or request" />
                  </Form.Item>
                  <Form.Item
                    name="message"
                    label="Message"
                    rules={[
                      { required: true, message: "Describe your concern" },
                    ]}
                  >
                    <Input.TextArea
                      rows={5}
                      placeholder="Describe what happened, what you expected, and any record, date, or screen involved."
                    />
                  </Form.Item>
                  <Form.Item label="Attachments (optional)" tooltip="Upload a screenshot or photo of the error, or any supporting document (image or PDF).">
                    <Upload
                      listType="picture"
                      multiple
                      accept="image/*,application/pdf"
                      fileList={(ticketAttachments || []).map((a, i) => ({
                        uid: a.url || String(i),
                        name: a.name || `attachment-${i + 1}`,
                        status: "done",
                        url: a.url,
                      }))}
                      customRequest={async ({ file, onSuccess, onError }) => {
                        setTicketUploading(true);
                        try {
                          const fd = new FormData();
                          fd.append("file", file);
                          const { data } = await api.post("/support-tickets/upload", fd, {
                            headers: { "Content-Type": "multipart/form-data" },
                          });
                          setTicketAttachments((prev) => [...prev, data]);
                          onSuccess(data, file);
                        } catch (err) {
                          const isDriveMaintenance = err.response?.status === 503 || err.response?.data?.driveMaintenanceMode;
                          if (isDriveMaintenance) {
                            onError(new Error("File uploads are temporarily unavailable. You can still submit the ticket without an attachment."));
                          } else {
                            onError(err);
                          }
                        } finally {
                          setTicketUploading(false);
                        }
                      }}
                      onRemove={(file) =>
                        setTicketAttachments((prev) =>
                          prev.filter((a) => (a.url || "") !== (file.url || file.uid)),
                        )
                      }
                    >
                      <Button icon={<UploadOutlined />} loading={ticketUploading}>
                        Upload screenshot / proof
                      </Button>
                    </Upload>
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
                  </div>
                </div>
              ),
            },
            {
              key: "my-tickets",
              label: (
                <span className="slf-support-tab-label">
                  <span className="slf-support-tab-icon slf-support-tab-icon-orange"><FileTextOutlined /></span>
                  My Tickets
                  {supportUnreadCount > 0 && (
                    <Badge count={supportUnreadCount} size="small" style={{ marginLeft: 6 }} />
                  )}
                </span>
              ),
              children: (
                <div className="slf-support-pane">
                  <div className="slf-support-section-header">
                    <div>
                      <div className="slf-support-section-title">My Tickets</div>
                      <Text type="secondary">Review status changes, open threads, and admin replies.</Text>
                    </div>
                    <Tag color="geekblue">{supportTicketPagination.total || portalSupportTickets.length} total</Tag>
                  </div>
                  <Input
                    allowClear
                    prefix={<SearchOutlined />}
                    placeholder="Search tickets"
                    defaultValue={supportTicketSearch}
                    style={{ marginBottom: 12, maxWidth: 320 }}
                    onPressEnter={(event) => fetchSupportTickets({ page: 1, search: event.currentTarget.value })}
                    onChange={(event) => {
                      if (!event.target.value) fetchSupportTickets({ page: 1, search: "" });
                    }}
                  />
                  {supportLoading ? (
                    <div style={{ textAlign: "center", padding: 40 }}>
                      <Spin />
                    </div>
                  ) : portalSupportTickets.length === 0 ? (
                    <Empty description="No support tickets yet" />
                  ) : (
                    <Table
                      dataSource={portalSupportTickets}
                      columns={supportTicketColumns}
                      rowKey="_id"
                      size="small"
                      scroll={{ x: 900 }}
                      pagination={{
                        current: supportTicketPagination.current,
                        pageSize: supportTicketPagination.pageSize,
                        total: supportTicketPagination.total,
                        showSizeChanger: true,
                        pageSizeOptions: ["10", "20", "50", "100"],
                        showTotal: (total) => `${total} ticket(s)`,
                      }}
                      onChange={(pagination, _filters, sorter) => {
                        fetchSupportTickets({
                          page: pagination.current,
                          pageSize: pagination.pageSize,
                          sorter: {
                            field: Array.isArray(sorter) ? "createdAt" : sorter.field || "createdAt",
                            order: Array.isArray(sorter) ? "descend" : sorter.order || "descend",
                          },
                        });
                      }}
                    />
                  )}
                </div>
              ),
            },
          ]}
          />
        </div>
      </Modal>

      {/* ── Support Ticket Detail Modal ── */}
      <Modal
        title={supportDetailModal ? (
          <div className="slf-support-detail-title-wrap">
            <span className="slf-support-detail-title-icon"><MessageOutlined /></span>
            <div>
              <div className="slf-support-detail-title-main">
                {supportDetailModal.source === "admin_message" ? "Message" : supportDetailModal.ticketNo}
              </div>
              <Text type="secondary">{supportDetailModal.subject}</Text>
            </div>
          </div>
        ) : "Thread Detail"}
        open={!!supportDetailModal}
        onCancel={() => {
          setSupportDetailModal(null);
          setSupportReplyText("");
        }}
        footer={null}
        width={680}
      >
        {supportDetailModal && (
          <div className="slf-support-detail-shell">
            <div className="slf-support-detail-summary">
              <div className="slf-support-detail-summary-item">
                <span className="slf-support-mini-icon slf-support-mini-icon-blue"><InfoCircleOutlined /></span>
                <div>
                  <div className="slf-support-detail-label">Status</div>
                  <Tag color={getSupportStatusColor(supportDetailModal.status)}>
                    {supportDetailModal.status?.replace("_", " ").toUpperCase()}
                  </Tag>
                </div>
              </div>
              <div className="slf-support-detail-summary-item">
                <span className="slf-support-mini-icon slf-support-mini-icon-orange"><AuditOutlined /></span>
                <div>
                  <div className="slf-support-detail-label">Priority</div>
                  <Tag color={getSupportPriorityColor(supportDetailModal.priority)}>
                    {supportDetailModal.priority}
                  </Tag>
                </div>
              </div>
              <div className="slf-support-detail-summary-item">
                <span className="slf-support-mini-icon slf-support-mini-icon-green"><FileTextOutlined /></span>
                <div>
                  <div className="slf-support-detail-label">Category</div>
                  {/* The LABEL above already carries the emphasis; bolding the
                      value too made the whole block read as a heading. */}
                  <Text className="slf-support-detail-value">{supportDetailModal.category}</Text>
                </div>
              </div>
            </div>
            <Descriptions
              size="small"
              column={1}
              bordered
              className="slf-support-detail-descriptions"
            >
              <Descriptions.Item label="Status">
                <Tag color={getSupportStatusColor(supportDetailModal.status)}>
                  {supportDetailModal.status?.replace("_", " ").toUpperCase()}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Category">
                {supportDetailModal.category}
              </Descriptions.Item>
              <Descriptions.Item label="Priority">
                <Tag color={getSupportPriorityColor(supportDetailModal.priority)}>
                  {supportDetailModal.priority}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Date">
                {dayjs(supportDetailModal.createdAt).format(
                  "MMM D, YYYY h:mm A",
                )}
              </Descriptions.Item>
            </Descriptions>
            <div
              className="slf-support-detail-message"
            >
              <Text>{supportDetailModal.message}</Text>
            </div>
            {Array.isArray(supportDetailModal.attachments) &&
              supportDetailModal.attachments.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0" }}>
                  {supportDetailModal.attachments.map((att, i) => (
                    <TicketAttachment key={i} att={att} index={i} />
                  ))}
                </div>
              )}
            {supportDetailModal.replies?.length > 0 && (
              <>
                <Divider style={{ margin: "12px 0" }}>Replies</Divider>
                {supportDetailModal.replies.map((r, i) => (
                  <div
                    key={i}
                    className={`slf-support-reply-bubble ${r.isAdmin ? "slf-support-reply-admin" : "slf-support-reply-user"}`}
                  >
                    <div className="slf-support-reply-meta">
                      <Text strong style={{ fontSize: 12 }}>
                        {r.isAdmin ? "Admin" : "You"}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {dayjs(r.createdAt).format("MMM D, h:mm A")}
                      </Text>
                    </div>
                    <Text style={{ fontSize: 13 }}>{r.message}</Text>
                  </div>
                ))}
              </>
            )}
            {supportDetailModal.status !== "closed" &&
              supportDetailModal.status !== "resolved" && (
                <div className="slf-support-reply-box">
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
          </div>
        )}
      </Modal>

      {/* ── Excel Upload Progress Modal ── */}
      <Modal
        title={
          <Space>
            <UploadOutlined style={{ color: uploadProgressError ? "#cf1322" : "#1677ff" }} />
            <Text strong>{uploadProgressError ? "Upload Issue" : "Processing Upload"}</Text>
          </Space>
        }
        open={!!uploadProgressOpen}
        closable={!!uploadProgressError}
        maskClosable={false}
        keyboard={false}
        onCancel={() => setUploadProgressOpen(false)}
        footer={
          uploadProgressError ? (
            <Button type="primary" className="slf-primary-btn" onClick={() => setUploadProgressOpen(false)}>
              Close
            </Button>
          ) : null
        }
        width={460}
      >
        <div style={{ padding: "8px 4px" }}>
          <Progress
            percent={uploadProgress}
            status={uploadProgressError ? "exception" : uploadProgress >= 100 ? "success" : "active"}
            strokeColor={uploadProgressError ? undefined : { from: "#108ee9", to: "#1a3353" }}
          />
          <div style={{ marginTop: 12, textAlign: "center" }}>
            <Text type={uploadProgressError ? "danger" : "secondary"}>
              {uploadStatusText || "Please wait…"}
            </Text>
          </div>
        </div>
      </Modal>

      {/* ── Upload Format Guide Modal ── */}
      <Modal
        title={
          <Space>
            <InfoCircleOutlined style={{ color: "#1677ff" }} />
            <Text strong>
              {uploadGuideType === "hauler"
                ? "Hauler Upload — Format Guide"
                : "Disposal Entry Upload — Format Guide"}
            </Text>
          </Space>
        }
        open={uploadGuideOpen}
        onCancel={() => setUploadGuideOpen(false)}
        onOk={proceedToFilePicker}
        okText={
          <Space>
            <UploadOutlined /> Proceed to Upload
          </Space>
        }
        okButtonProps={{ className: "slf-primary-btn" }}
        cancelText="Cancel"
        // Same treatment as the preview it precedes: never wider than the
        // viewport, and full-bleed below a laptop rather than a squeezed card.
        width="min(1180px, 100%)"
        style={{ top: 24 }}
        className="slf-upload-modal"
        destroyOnHidden
      >
        {uploadGuideType === "hauler" ? (
          <HaulerUploadGuide
            downloadHaulerTemplate={downloadHaulerTemplate}
            exportHaulerData={exportHaulerData}
            haulerCount={(haulers || []).length}
            isNarrow={isNarrowScreen}
          />
        ) : (
          <div>
            <Text
              type="secondary"
              style={{ display: "block", marginBottom: 12 }}
            >
              Your Excel or CSV file must contain the exact column headers below (in any order). The Client column is required and must follow Selected SLF → Hauler → Client.
            </Text>
            <Button
              icon={<DownloadOutlined />}
              onClick={downloadDisposalTemplate}
              style={{ marginBottom: 12 }}
              type="primary"
            >
              Download Template
            </Button>
            <Table
              size="small"
              pagination={false}
              scroll={{ x: 830 }}
              dataSource={UPLOAD_COLUMNS.truck.map((column) => ({
                col: column.label,
                desc: column.description,
                required: column.required,
                format: column.format,
                sample: column.sample,
              }))}
              columns={[
                {
                  title: "Column Header",
                  dataIndex: "col",
                  width: 180,
                  render: (v) => <Text code>{v}</Text>,
                },
                { title: "Description", dataIndex: "desc" },
                { title: "Accepted Format", dataIndex: "format", width: 220 },
                {
                  title: "Sample",
                  dataIndex: "sample",
                  width: 150,
                  render: (v) => <Text code>{v}</Text>,
                },
                {
                  title: "Required",
                  dataIndex: "required",
                  width: 80,
                  align: "center",
                  render: (v) =>
                    v ? <Tag color="red">Yes</Tag> : <Tag>No</Tag>,
                },
              ]}
              rowKey="col"
            />
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                background: "#fffbe6",
                borderRadius: 6,
                border: "1px solid #ffe58f",
              }}
            >
              <Text style={{ fontSize: 12 }}>
                <InfoCircleOutlined
                  style={{ color: "#faad14", marginRight: 6 }}
                />
                Common upload errors include a missing <Text code>Client</Text> column, an empty Client value, an unknown hauler, a client that belongs to another hauler or SLF, duplicate/ambiguous client records, inactive clients, invalid units, and unavailable disposal cells. The upload never creates new clients automatically.
              </Text>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Upload Preview Modal ── */}
      <Modal
        title={
          <Space>
            <UploadOutlined />
            <Text strong>Preview Uploaded Data</Text>
          </Space>
        }
        open={uploadModalOpen}
        onCancel={() => {
          setUploadModalOpen(false);
          setUploadPreviewData([]);
          setUploadPreviewColumns([]);
          setUploadMissingColumns([]);
          setUploadType(null);
        }}
        onOk={handleConfirmUpload}
        okText={`Import ${uploadPreviewData.length} ${uploadType === "hauler" ? "Hauler(s)" : "Entry/Entries"}`}
        okButtonProps={{
          className: "slf-primary-btn",
          disabled: (uploadMissingColumns || []).length > 0 || uploadPreviewData.some((row) => row._errors?.length),
        }}
        // Never wider than the viewport allows. Below a laptop the stylesheet
        // takes the modal full-bleed (see .slf-upload-preview-modal) — the grid
        // simply cannot be narrowed to a phone, so it gets the whole screen and
        // scrolls sideways inside a pinned frame instead of overflowing the page.
        width="min(1400px, 100%)"
        style={{ top: 24 }}
        className="slf-upload-modal slf-upload-preview-modal"
      >
        <div style={{ marginBottom: 12 }}>
          <Space wrap size={[6, 6]}>
            <Tag color="blue">{uploadPreviewData.length} row(s)</Tag>
            <Tag color="green">
              {uploadPreviewData.filter((row) => !row._errors?.length).length} valid
            </Tag>
            <Tag color={uploadPreviewData.some((row) => row._errors?.length) || (uploadMissingColumns || []).length ? "red" : "default"}>
              {(uploadMissingColumns || []).length + uploadPreviewData.filter((row) => row._errors?.length).length} issue(s)
            </Tag>
            {/* What the import will DO — resolved against the haulers already on
                the baseline, so the operation is visible before it is confirmed. */}
            {uploadType === "hauler" && (
              <>
                <Tag color="green">{uploadPreviewSummary.newHaulers || 0} new hauler(s)</Tag>
                <Tag color="blue">{uploadPreviewSummary.updatedHaulers || 0} existing hauler(s) to update</Tag>
                {uploadPreviewSummary.duplicates > 0 && (
                  <Tag color="orange">{uploadPreviewSummary.duplicates} duplicate row(s)</Tag>
                )}
              </>
            )}
          </Space>
        </div>
        {((uploadMissingColumns || []).length > 0 || uploadPreviewData.some((row) => row._errors?.length)) && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="Import is disabled until the preview is valid."
            description={
              (uploadMissingColumns || []).length > 0
                ? `Missing columns: ${uploadMissingColumns.join(", ")}.`
                : "Edit the highlighted row values in the preview table."
            }
          />
        )}
        {uploadType === "hauler" &&
          (uploadMissingColumns || []).length === 0 &&
          !uploadPreviewData.some((row) => row._errors?.length) && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="Nothing is saved yet."
              description={
                uploadPreviewSummary.duplicates > 0
                  ? `Importing adds the new haulers and updates the existing ones in the table below — no hauler is removed. ${uploadPreviewSummary.duplicates} repeated row(s) will be merged into the row they duplicate; delete a row if the repeat was unintended. Click "Save Baseline Update" afterwards to persist the changes.`
                  : 'Importing adds the new haulers and updates the existing ones — no hauler is removed. Click "Save Baseline Update" afterwards to persist the changes.'
              }
            />
          )}
        {/* ── VERA assessment ──
            A SECOND OPINION on a batch that already passed validation, never a
            gate: the Import button's disabled state above does not reference
            haulerVeraStage, and it must not start to. VERA is pointed at what
            this import gets wrong QUIETLY — a near-miss hauler name that adds a
            second hauler instead of updating one, an implausible capacity, a new
            client with no province — none of which is invalid, so none of which
            the validator can or should block. */}
        {uploadType === "hauler" && haulerVeraStage !== "idle" && (
          <div className="slf-hauler-vera-panel">
            <div className="slf-hauler-vera-head">
              <VeraFlameIcon size={18} anime={haulerVeraStage === "assessing"} />
              <Text strong style={{ fontSize: 12.5 }}>
                VERA Assessment
              </Text>
              {haulerVeraStage === "assessing" && <Spin size="small" />}
              {haulerVeraStage === "done" && (
                <Tag color="success" style={{ fontSize: 10, marginInlineEnd: 0 }}>
                  Assessed
                </Tag>
              )}
              {haulerVeraStage === "failed" && (
                <Tag color="warning" style={{ fontSize: 10, marginInlineEnd: 0 }}>
                  Not available
                </Tag>
              )}
              {haulerVeraSource === "guard" && (
                <Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>from your data</Tag>
              )}
              <span style={{ flex: 1 }} />
              {haulerVeraStage !== "assessing" && (
                <Button size="small" type="text" onClick={reassessHaulerUpload}>
                  {haulerVeraStage === "failed" ? "Retry assessment" : "Re-assess edited rows"}
                </Button>
              )}
            </div>

            {haulerVeraStage === "assessing" && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                VERA is reviewing the {uploadPreviewData.length} validated row(s) before you
                import them…
              </Text>
            )}

            {/* A VERA failure is NOT a validation failure — say so plainly and
                leave Import exactly as available as it already was. */}
            {haulerVeraStage === "failed" && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 0 }}
                message="VERA assessment could not be completed"
                description={
                  <span style={{ fontSize: 12 }}>
                    {haulerVeraError} Your preview is still <b>valid</b> and can be imported.
                  </span>
                }
              />
            )}

            {haulerVeraStage === "done" && (
              <div className="slf-hauler-vera-comment">{haulerVeraComment}</div>
            )}
          </div>
        )}
        <Table
          className="slf-upload-preview-table slf-slim-scroll"
          dataSource={uploadPreviewData}
          columns={(uploadPreviewColumns || []).map((col) => {
            // Row number and hauler/ticket identity stay put while the rest of
            // the grid scrolls sideways, so an edit three columns to the right is
            // never made against a row the operator can no longer identify.
            // Only above `lg`: on a phone two frozen columns would leave almost
            // no scrollable area at all.
            const isIdentityColumn =
              col?.title === "#" ||
              ["index", "haulerName", "disposalTicketNo"].includes(col?.key);
            const pinned = isNarrowScreen
              ? null
              : isIdentityColumn
                ? { fixed: "left" }
                : col?.key === "actions"
                  ? { fixed: "right" }
                  : null;
            // keep the row-number (#) and actions columns as-is
            if (!col || !col.dataIndex || col.key === "actions" || col.title === "#")
              return pinned ? { ...col, ...pinned } : col;
            return {
              ...col,
              ...pinned,
              render: (text, record) => (
                ["truckCapacity", "actualVolume", "numberOfTrucks", "capacity"].includes(col.dataIndex) ? (
                  <InputNumber
                    size="small"
                    value={text ?? null}
                    min={0}
                    controls={false}
                    onChange={(value) =>
                      updateUploadCell(record.key, col.dataIndex, value)
                    }
                    style={{ width: "100%" }}
                  />
                ) : col.dataIndex === "cellName" && uploadType === "truck" ? (
                  // The cell that came from the file is pre-selected here, so a
                  // valid uploaded placement never has to be re-assigned by hand.
                  // A picker (not free text) is what keeps an EDITED placement a
                  // real cell — updateUploadCell re-resolves the canonical
                  // cellIndex from this value before import.
                  <Select
                    size="small"
                    value={text || undefined}
                    placeholder="Select cell"
                    style={{ width: "100%" }}
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    status={record.cellIndex == null && text ? "error" : ""}
                    classNames={{ popup: { root: UPLOAD_PREVIEW_POPUP_CLASS } }}
                    options={activeCellOptions.map((option) => ({
                      label: option.label,
                      value: option.value,
                    }))}
                    onChange={(value) =>
                      updateUploadCell(record.key, col.dataIndex, value || "")
                    }
                  />
                ) : col.dataIndex === "capacityUnit" ? (
                  // A picker, not free text: the stored unit is enum-constrained,
                  // so an unusable value from the file is corrected in one click
                  // instead of sending the operator back to the spreadsheet.
                  <Select
                    size="small"
                    value={text || undefined}
                    placeholder="Unit"
                    style={{ width: "100%" }}
                    status={text && !["tons", "m³", "m3"].includes(String(text)) ? "error" : ""}
                    classNames={{ popup: { root: UPLOAD_PREVIEW_POPUP_CLASS } }}
                    options={[
                      { label: "tons", value: "tons" },
                      { label: "m³", value: "m³" },
                    ]}
                    onChange={(value) =>
                      updateUploadCell(record.key, col.dataIndex, value || "")
                    }
                  />
                ) : col.dataIndex === "privateSectorClients" ? (
                  <Select
                    mode="tags"
                    size="small"
                    value={Array.isArray(text) ? text : []}
                    onChange={(value) =>
                      updateUploadCell(record.key, col.dataIndex, value)
                    }
                    // The clients already on this baseline, plus whatever the
                    // row itself carries (a name typed in the file that is not
                    // stored yet must still show as a selected tag).
                    options={mergeSelectOptions(
                      uploadClientOptions,
                      (Array.isArray(text) ? text : []).map((clientName) => ({
                        label: String(clientName ?? "").trim(),
                        value: String(clientName ?? "").trim(),
                      })),
                    )}
                    placeholder="Select encoded clients"
                    style={{ width: "100%" }}
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    tokenSeparators={[","]}
                    notFoundContent="Type and press Enter to add a new client"
                    classNames={{ popup: { root: UPLOAD_PREVIEW_POPUP_CLASS } }}
                    // No `maxTagCount` on purpose: collapsing the tags to "+2"
                    // hid the very client names this preview exists to check.
                    // The selector wraps them onto as many lines as they need.
                  />
                ) : UPLOAD_PREVIEW_LONG_TEXT_FIELDS.includes(col.dataIndex) ? (
                  // Long free-text columns edit in an auto-sizing TextArea, not a
                  // single-line Input: an Input scrolls its value out of sight, so
                  // a long hauler name or address was hidden by the very cell it
                  // was being reviewed in. This grows to the text (capped at four
                  // lines) and wraps, which is what makes the preview readable.
                  <TextArea
                    size="small"
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    value={Array.isArray(text) ? text.join(", ") : text ?? ""}
                    onChange={(e) =>
                      updateUploadCell(record.key, col.dataIndex, e.target.value)
                    }
                    style={{
                      border: "none",
                      background: "transparent",
                      padding: "2px 4px",
                      fontSize: 11,
                      lineHeight: 1.25,
                      resize: "none",
                    }}
                  />
                ) : (
                  <Input
                    size="small"
                    value={Array.isArray(text) ? text.join(", ") : text ?? ""}
                    onChange={(e) =>
                      updateUploadCell(record.key, col.dataIndex, e.target.value)
                    }
                    placeholder={
                      col.dataIndex === "privateSectorClients"
                        ? "Comma-separated clients (optional)"
                        : undefined
                    }
                    style={{
                      border: "none",
                      background: "transparent",
                      padding: "2px 4px",
                      fontSize: 11,
                      lineHeight: 1.25,
                    }}
                  />
                )
              ),
              onCell: () => ({
                style: {
                  fontSize: 11,
                  lineHeight: 1.25,
                  whiteSpace: "normal",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                  verticalAlign: "top",
                },
              }),
            };
          })}
          rowKey="key"
          size="small"
          tableLayout="fixed"
          pagination={{ pageSize: 20, showSizeChanger: false }}
          // The horizontal extent is the SUM of the declared column widths, so
          // the header and the body always agree on where a column starts. A
          // hardcoded `x` narrower than that sum is what skewed the preview: AntD
          // laid the table out at the real width while sizing against the smaller
          // one.
          //
          // `y` is viewport-relative and keeps the header pinned while the rows
          // scroll, so the modal fits a laptop as well as a large screen. The
          // clamp is what makes it survive a SHORT viewport (a phone in
          // landscape, a half-height browser window): a bare 52vh collapses to a
          // couple of rows there and pushes the Import button off-screen, while
          // the 460px ceiling stops the table from stretching on a tall monitor.
          scroll={{
            x:
              (uploadPreviewColumns || []).reduce(
                (sum, col) => sum + (Number(col?.width) || 120),
                0,
              ) || 980,
            y: "clamp(180px, 52vh, 460px)",
          }}
          rowClassName={(record) =>
            record._errors?.length
              ? "slf-upload-row-error"
              : record._duplicateOfRow != null
                ? "slf-upload-row-duplicate"
                : ""
          }
        />
      </Modal>

      {/* ── Active Cell Entry Modal ── */}
      <Modal
        title={
          editingActiveCellKey != null ? "Edit Cell Entry" : "Add Cell Entry"
        }
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
            <Select
              showSearch
              placeholder="Select a cell from the cell infrastructure"
              value={activeCellDraft.cellName || undefined}
              onChange={(value) => {
                const opt = (baselineCellOptions.length
                  ? baselineCellOptions
                  : activeCellOptions
                ).find((o) => o.value === value);
                setActiveCellDraft((d) => ({
                  ...d,
                  cellName: value,
                  cellType: opt?.cellType ?? d.cellType,
                  cellIndex:
                    opt && typeof opt.cellIndex === "number"
                      ? opt.cellIndex
                      : d.cellIndex ?? null,
                }));
              }}
              options={(() => {
                const base = baselineCellOptions.length
                  ? baselineCellOptions
                  : activeCellOptions;
                // Keep the current cell selectable even if it is no longer
                // part of the configured cell infrastructure.
                if (
                  activeCellDraft.cellName &&
                  !base.some((o) => o.value === activeCellDraft.cellName)
                ) {
                  return [
                    { label: `${activeCellDraft.cellName} (not in cell infra)`, value: activeCellDraft.cellName },
                    ...base,
                  ];
                }
                return base;
              })()}
              notFoundContent="No cells configured in the cell infrastructure"
            />
          </Form.Item>
          <Form.Item label="Waste Type" required>
            <Select
              value={activeCellDraft.wasteType}
              onChange={(v) =>
                setActiveCellDraft((d) => ({ ...d, wasteType: v }))
              }
              options={[
                { label: "Residual", value: "Residual" },
                {
                  label: "Inert/Hazardous Waste",
                  value: "Inert/Hazardous Waste",
                },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="Volume"
            required
            extra={
              <CellEntryUnitHint
                draftUnit={activeCellDraft.unit}
                declaredUnit={baselineUnit}
              />
            }
          >
            <Space.Compact style={{ width: "100%" }}>
              <InputNumber
                placeholder="Volume"
                style={{ width: "100%" }}
                min={0}
                step={0.01}
                value={activeCellDraft.volume}
                onChange={(v) =>
                  setActiveCellDraft((d) => ({ ...d, volume: v }))
                }
              />
              <Select
                value={normalizeUnitLabel(activeCellDraft.unit || baselineUnit || baselineUnit)}
                // Switching the unit CONVERTS the value instead of just relabelling
                // it. Previously "100" encoded as m³ became "100 tons" on switch —
                // a 5× overstatement — because only the label changed.
                onChange={(unit) =>
                  setActiveCellDraft((d) => convertCellDraftUnit(d, unit, baselineUnit))
                }
                style={{ width: 96 }}
              >
                <Option value="m³">m³</Option>
                <Option value="tons">tons</Option>
              </Select>
            </Space.Compact>
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Closed Cell Entry Modal ── */}
      <Modal
        title={
          editingClosedCellKey != null
            ? "Edit Closed Cell Entry"
            : "Add Closed Cell Entry"
        }
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
            <Select
              showSearch
              placeholder="Select a cell from the cell infrastructure"
              value={closedCellDraft.cellName || undefined}
              onChange={(value) => {
                const opt = baselineCellOptions.find((o) => o.value === value);
                setClosedCellDraft((d) => ({
                  ...d,
                  cellName: value,
                  cellType: opt?.cellType ?? d.cellType,
                  cellIndex:
                    opt && typeof opt.cellIndex === "number"
                      ? opt.cellIndex
                      : d.cellIndex ?? null,
                }));
              }}
              options={(() => {
                const base = baselineCellOptions;
                if (
                  closedCellDraft.cellName &&
                  !base.some((o) => o.value === closedCellDraft.cellName)
                ) {
                  return [
                    { label: `${closedCellDraft.cellName} (not in cell infra)`, value: closedCellDraft.cellName },
                    ...base,
                  ];
                }
                return base;
              })()}
              notFoundContent="No cells configured in the cell infrastructure"
            />
          </Form.Item>
          <Form.Item label="Waste Type" required>
            <Select
              value={closedCellDraft.wasteType}
              onChange={(v) =>
                setClosedCellDraft((d) => ({ ...d, wasteType: v }))
              }
              options={[
                { label: "Residual", value: "Residual" },
                {
                  label: "Inert/Hazardous Waste",
                  value: "Inert/Hazardous Waste",
                },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="Volume"
            required
            extra={
              <CellEntryUnitHint
                draftUnit={closedCellDraft.unit}
                declaredUnit={baselineUnit}
              />
            }
          >
            <Space.Compact style={{ width: "100%" }}>
              <InputNumber
                placeholder="Volume"
                style={{ width: "100%" }}
                min={0}
                step={0.01}
                value={closedCellDraft.volume}
                onChange={(v) =>
                  setClosedCellDraft((d) => ({ ...d, volume: v }))
                }
              />
              <Select
                value={normalizeUnitLabel(closedCellDraft.unit || baselineUnit || baselineUnit)}
                // Converts the value on unit change — see the active-cell modal.
                onChange={(unit) =>
                  setClosedCellDraft((d) => convertCellDraftUnit(d, unit, baselineUnit))
                }
                style={{ width: 96 }}
              >
                <Option value="m³">m³</Option>
                <Option value="tons">tons</Option>
              </Select>
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
              onChange={(e) =>
                setClientDraft((d) => ({ ...d, clientName: e.target.value }))
              }
            />
          </Form.Item>
          <Form.Item label="Client Type" required>
            <Select
              value={clientDraft.clientType}
              onChange={(v) =>
                setClientDraft((d) => ({
                  ...d,
                  clientType: v,
                  region: "",
                  province: "",
                  municipality: "",
                }))
              }
              options={[
                { label: "Private", value: "Private" },
                { label: "LGU", value: "LGU" },
              ]}
            />
          </Form.Item>
          {/* Location applies to BOTH LGU and Private clients — the saved Province
              is what classifies the client within / outside Region 3. */}
          {clientDraft.clientType && (
            <>
              <Form.Item label="Region">
                <Select
                  placeholder="Select region"
                  value={clientDraft.region || undefined}
                  loading={loadingClientAddress === "region"}
                  showSearch
                  optionFilterProp="label"
                  options={(regions || []).map((r) => ({
                    label: r.name,
                    value: String(r.code),
                  }))}
                  onChange={async (v) => {
                    setClientDraft((d) => ({
                      ...d,
                      region: v,
                      province: "",
                      municipality: "",
                    }));
                    setClientProvinces([]);
                    setClientMunicipalities([]);
                    setLoadingClientAddress("province");
                    try {
                      const res = await fetch(
                        `https://psgc.gitlab.io/api/regions/${v}/provinces/`,
                      );
                      setClientProvinces(await res.json());
                    } catch (_) {}
                    setLoadingClientAddress("");
                  }}
                />
              </Form.Item>
              <Form.Item label="Province" required>
                <Select
                  placeholder="Select province"
                  value={clientDraft.province || undefined}
                  loading={loadingClientAddress === "province"}
                  showSearch
                  optionFilterProp="label"
                  options={(clientProvinces || []).map((p) => ({
                    label: p.name,
                    value: String(p.code),
                  }))}
                  onChange={async (v) => {
                    setClientDraft((d) => ({
                      ...d,
                      province: v,
                      municipality: "",
                    }));
                    setClientMunicipalities([]);
                    setLoadingClientAddress("municipality");
                    try {
                      const res = await fetch(
                        `https://psgc.gitlab.io/api/provinces/${v}/cities-municipalities/`,
                      );
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
                  options={(clientMunicipalities || []).map((m) => ({
                    label: m.name,
                    value: String(m.code),
                  }))}
                  onChange={(v) =>
                    setClientDraft((d) => ({ ...d, municipality: v }))
                  }
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
        onCancel={() => {
          setHaulerDeleteModal({ open: false, hauler: null });
          setHaulerDeleteReason("");
          setHaulerDeleteFile(null);
        }}
        onOk={async () => {
          if (!haulerDeleteReason.trim()) {
            return;
          }
          setHaulerDeleteLoading(true);
          try {
            const h = haulerDeleteModal.hauler;
            const fd = new FormData();
            fd.append("portalUserEmail", portalUser?.email || "");
            fd.append(
              "portalUserName",
              portalUser
                ? `${portalUser.firstName || ""} ${portalUser.lastName || ""}`.trim()
                : "",
            );
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
              content:
                "Your hauler deletion request has been submitted. EMB Region 3 will review it and you will be notified of the decision.",
            });
          } catch (err) {
            Modal.error({
              title: "Submission Failed",
              content:
                err?.response?.data?.message ||
                "Could not submit the request. Please try again.",
            });
          } finally {
            setHaulerDeleteLoading(false);
          }
        }}
        okText="Submit Request"
        okButtonProps={{
          danger: true,
          loading: haulerDeleteLoading,
          disabled: !haulerDeleteReason.trim(),
        }}
        cancelText="Cancel"
        destroyOnHidden
        width={520}
      >
        <div
          style={{
            background: "#fff2f0",
            border: "1px solid #ffccc7",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 16,
          }}
        >
          <Text style={{ fontSize: 12, color: "#cf1322" }}>
            <strong>Note:</strong> Hauler deletion requires EMB Region 3
            approval. Please provide a valid justification and attach a Letter
            of Intent.
          </Text>
        </div>
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="Hauler to be Deleted">
            <Input
              value={haulerDeleteModal.hauler?.haulerName || ""}
              disabled
            />
          </Form.Item>
          <Form.Item
            label="Reason / Justification"
            required
            validateStatus={haulerDeleteReason.trim() ? "" : "error"}
            help={!haulerDeleteReason.trim() ? "Please provide a reason." : ""}
          >
            <Input.TextArea
              rows={4}
              placeholder="Explain the reason for requesting this hauler to be deleted..."
              value={haulerDeleteReason}
              onChange={(e) => setHaulerDeleteReason(e.target.value)}
              maxLength={1000}
              showCount
            />
          </Form.Item>
          <Form.Item
            label="Letter of Intent (PDF, DOC, DOCX, JPG, PNG)"
            extra="Maximum 20 MB"
          >
            <input
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              style={{ display: "none" }}
              id="hauler-loi-file-input"
              onChange={(e) => setHaulerDeleteFile(e.target.files[0] || null)}
            />
            <Space>
              <Button
                icon={<UploadOutlined />}
                onClick={() =>
                  document.getElementById("hauler-loi-file-input").click()
                }
              >
                {haulerDeleteFile ? "Change File" : "Attach File"}
              </Button>
              {haulerDeleteFile && (
                <Space size={4}>
                  <Text style={{ fontSize: 12 }}>{haulerDeleteFile.name}</Text>
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => {
                      setHaulerDeleteFile(null);
                      document.getElementById("hauler-loi-file-input").value =
                        "";
                    }}
                  />
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
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "linear-gradient(135deg, #fa8c16, #d46b08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <BarChartOutlined style={{ color: "#fff", fontSize: 16 }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1a3353" }}>
                Waste Received Breakdown
              </div>
              <div style={{ fontSize: 11, color: "#8c8c8c", fontWeight: 400 }}>
                {activeSlfName}
              </div>
            </div>
          </div>
        }
        open={wasteReceivedModalOpen}
        onCancel={() => setWasteReceivedModalOpen(false)}
        footer={
          <Button onClick={() => setWasteReceivedModalOpen(false)}>
            Close
          </Button>
        }
        width={1200}
        destroyOnHidden
      >
        <Spin spinning={wasteReceivedLoading} tip="Loading breakdown...">
          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={8}>
              <Card size="small" style={{ borderRadius: 8 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Baseline Clients</Text>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#1a3353" }}>{baselineBreakdownRows.length}</div>
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" style={{ borderRadius: 8 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Submission Clients</Text>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#fa8c16" }}>{submittedBreakdownRows.length}</div>
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" style={{ borderRadius: 8 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Waste Filled</Text>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#52c41a" }}>{formatClientVolume({
                  totalM3: Number(wasteReceivedData.baselineTotals?.m3 || 0) + Number(wasteReceivedData.totals?.m3 || 0),
                  totalTons: Number(wasteReceivedData.baselineTotals?.tons || 0) + Number(wasteReceivedData.totals?.tons || 0),
                })}</div>
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
            <Col xs={24} md={12}>
              <Card size="small" title={<Text style={{ fontSize: 12 }}>Baseline Categories</Text>} bodyStyle={{ padding: 10 }}>
                {renderCategoryDonuts(baselineCategoryCounts, baselineBreakdownRows.length, "baseline")}
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card size="small" title={<Text style={{ fontSize: 12 }}>Submission Categories</Text>} bodyStyle={{ padding: 10 }}>
                {renderCategoryDonuts(submissionCategoryCounts, submittedBreakdownRows.length, "submission")}
              </Card>
            </Col>
          </Row>

          <Alert
            type="info"
            showIcon
            message="Client-level names and submission volumes are hidden for confidentiality."
            description="Only totals and category charts are shown in this breakdown."
          />
          {false && (
          <>
          <Divider orientation="left" style={{ fontSize: 13 }}><TeamOutlined /> Baseline Client List</Divider>
          <Table
            size="small"
            className="slf-waste-breakdown-table"
            dataSource={baselineBreakdownRows}
            rowKey={(row, index) => `${row.clientName || row.company || index}-baseline-${index}`}
            pagination={{ pageSize: 5, size: "small" }}
            locale={{ emptyText: <Empty description="No baseline breakdown encoded" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            columns={[
              { title: "#", render: (_, __, index) => index + 1, width: 48 },
              { title: "Source", dataIndex: "clientName", ellipsis: true, render: (value, row) => value || row.company || "—" },
              { title: "Category", width: 180, render: (_, row) => <Tag color={/private/i.test(row.clientType || "") ? "green" : "blue"}>{getClientCategory(row)}</Tag> },
              { title: "Volume", width: 90, align: "center", render: () => <Tag>Hidden</Tag> },
              { title: "Province", dataIndex: "province", width: 150, render: (_, row) => getAddressLabel(row, "province") },
              { title: "Municipality", dataIndex: "municipality", width: 150, render: (_, row) => getAddressLabel(row, "municipality") },
            ]}
            style={{ marginBottom: 16 }}
          />

          <Divider orientation="left" style={{ fontSize: 13 }}><BarChartOutlined /> Submission Volume by Client</Divider>
          <Table
            size="small"
            className="slf-waste-breakdown-table"
            dataSource={submittedBreakdownRows}
            rowKey={(row, index) => `${row.clientName || row.company || index}-submission-${index}`}
            pagination={{ pageSize: 6, size: "small" }}
            locale={{ emptyText: <Empty description="No submitted client breakdown yet" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            columns={[
              { title: "#", render: (_, __, index) => index + 1, width: 48 },
              { title: "Client", dataIndex: "clientName", ellipsis: true, render: (value, row) => value || row.company || "—" },
              { title: "Category", width: 180, render: (_, row) => <Tag color={/private/i.test(row.clientType || "") ? "green" : "blue"}>{getClientCategory(row)}</Tag> },
              { title: "Truck Entries", dataIndex: "truckCount", width: 120, align: "center", render: (value, row) => Number(value || row.entries || 0).toLocaleString(undefined, { maximumFractionDigits: 1 }) },
              { title: "Volume", width: 90, align: "center", render: () => <Tag>Hidden</Tag> },
            ]}
          />
          </>
          )}
        </Spin>
      </Modal>

      {/* ══════════════════════ Leachate Treatment Plant MODAL ══════════════════════ */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "linear-gradient(135deg, #1890ff, #096dd9)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <WifiOutlined style={{ color: "#fff", fontSize: 16 }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1a3353" }}>
                Leachate Treatment Plant Management
              </div>
              <div style={{ fontSize: 11, color: "#8c8c8c" }}>
                Count registered: {slfInfo?.noOfLeachatePond ?? "—"}
              </div>
            </div>
          </div>
        }
        open={leachateModalOpen}
        onCancel={() => setLeachateModalOpen(false)}
        footer={[
          <Button
            key="add"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() =>
              setLeachateDetails((prev) => [
                ...prev,
                {
                  _key: Date.now(),
                  pondNo: prev.length + 1,
                  description: "",
                  status: "Active",
                  attachments: [],
                },
              ])
            }
          >
            Add Pond
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={facilityMgmtSaving}
            icon={<SaveOutlined />}
            onClick={() =>
              handleSaveFacilityDetails("leachate", leachateDetails)
            }
            style={{ background: "#1890ff" }}
          >
            Save
          </Button>,
          <Button key="close" onClick={() => setLeachateModalOpen(false)}>
            Close
          </Button>,
        ]}
        width={750}
        destroyOnHidden
      >
        {leachateDetails.length === 0 ? (
          <Empty
            description="No leachate pond records yet. Click 'Add Pond' to start."
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          leachateDetails.map((pond, idx) => (
            <div
              key={pond._key}
              style={{
                background: "#f8f9fb",
                borderRadius: 10,
                padding: 16,
                marginBottom: 12,
                border: "1px solid #e8e8e8",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <Tag color="blue" style={{ fontWeight: 700 }}>
                  Pond {idx + 1}
                </Tag>
                <Select
                  size="small"
                  value={pond.status || "Active"}
                  onChange={(v) =>
                    setLeachateDetails((p) =>
                      p.map((x, i) => (i === idx ? { ...x, status: v } : x)),
                    )
                  }
                  options={[
                    { label: "Active", value: "Active" },
                    { label: "Inactive", value: "Inactive" },
                    { label: "Under Maintenance", value: "Under Maintenance" },
                  ]}
                  style={{ width: 160 }}
                />
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  style={{ marginLeft: "auto" }}
                  onClick={() =>
                    setLeachateDetails((p) => p.filter((_, i) => i !== idx))
                  }
                />
              </div>
              <Row gutter={[12, 8]}>
                <Col xs={24} sm={8}>
                  <div
                    style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                  >
                    Pond No.
                  </div>
                  <InputNumber
                    size="small"
                    min={1}
                    value={pond.pondNo}
                    onChange={(v) =>
                      setLeachateDetails((p) =>
                        p.map((x, i) => (i === idx ? { ...x, pondNo: v } : x)),
                      )
                    }
                    style={{ width: "100%" }}
                  />
                </Col>
                <Col xs={24} sm={16}>
                  <div
                    style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                  >
                    Description
                  </div>
                  <Input
                    size="small"
                    value={pond.description}
                    placeholder="Pond description, dimensions, type..."
                    onChange={(e) =>
                      setLeachateDetails((p) =>
                        p.map((x, i) =>
                          i === idx ? { ...x, description: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Col>
              </Row>
            </div>
          ))
        )}
      </Modal>

      {/* ══════════════════════ GAS MANAGEMENT MODAL ══════════════════════ */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "linear-gradient(135deg, #52c41a, #389e0d)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <EnvironmentOutlined style={{ color: "#fff", fontSize: 16 }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1a3353" }}>
                Gas Management
              </div>
              <div style={{ fontSize: 11, color: "#8c8c8c" }}>
                Count registered: {slfInfo?.numberOfGasVents ?? "—"}
              </div>
            </div>
          </div>
        }
        open={gasVentModalOpen}
        onCancel={() => setGasVentModalOpen(false)}
        footer={[
          <Button
            key="add"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() =>
              setGasVentDetails((prev) => [
                ...prev,
                {
                  _key: Date.now(),
                  ventNo: prev.length + 1,
                  ventType: "",
                  description: "",
                  status: "Active",
                  attachments: [],
                },
              ])
            }
          >
            Add Vent
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={facilityMgmtSaving}
            icon={<SaveOutlined />}
            onClick={() => handleSaveFacilityDetails("gasVent", gasVentDetails)}
            style={{ background: "#52c41a", borderColor: "#52c41a" }}
          >
            Save
          </Button>,
          <Button key="close" onClick={() => setGasVentModalOpen(false)}>
            Close
          </Button>,
        ]}
        width={750}
        destroyOnHidden
      >
        {gasVentDetails.length === 0 ? (
          <Empty
            description="No gas management records yet. Click 'Add Vent' to start."
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          gasVentDetails.map((vent, idx) => (
            <div
              key={vent._key}
              style={{
                background: "#f6ffed",
                borderRadius: 10,
                padding: 16,
                marginBottom: 12,
                border: "1px solid #b7eb8f",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <Tag color="green" style={{ fontWeight: 700 }}>
                  Vent {idx + 1}
                </Tag>
                <Select
                  size="small"
                  value={vent.status || "Active"}
                  onChange={(v) =>
                    setGasVentDetails((p) =>
                      p.map((x, i) => (i === idx ? { ...x, status: v } : x)),
                    )
                  }
                  options={[
                    { label: "Active", value: "Active" },
                    { label: "Inactive", value: "Inactive" },
                    { label: "Under Maintenance", value: "Under Maintenance" },
                  ]}
                  style={{ width: 160 }}
                />
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  style={{ marginLeft: "auto" }}
                  onClick={() =>
                    setGasVentDetails((p) => p.filter((_, i) => i !== idx))
                  }
                />
              </div>
              <Row gutter={[12, 8]}>
                <Col xs={24} sm={8}>
                  <div
                    style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                  >
                    Vent No.
                  </div>
                  <InputNumber
                    size="small"
                    min={1}
                    value={vent.ventNo}
                    onChange={(v) =>
                      setGasVentDetails((p) =>
                        p.map((x, i) => (i === idx ? { ...x, ventNo: v } : x)),
                      )
                    }
                    style={{ width: "100%" }}
                  />
                </Col>
                <Col xs={24} sm={8}>
                  <div
                    style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                  >
                    Vent Type
                  </div>
                  <Input
                    size="small"
                    value={vent.ventType}
                    placeholder="e.g. Passive, Active"
                    onChange={(e) =>
                      setGasVentDetails((p) =>
                        p.map((x, i) =>
                          i === idx ? { ...x, ventType: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Col>
                <Col xs={24} sm={8}>
                  <div
                    style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                  >
                    Description
                  </div>
                  <Input
                    size="small"
                    value={vent.description}
                    placeholder="Location, specs..."
                    onChange={(e) =>
                      setGasVentDetails((p) =>
                        p.map((x, i) =>
                          i === idx ? { ...x, description: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Col>
              </Row>
            </div>
          ))
        )}
      </Modal>

      {/* ══════════════════════ TRASH SLIDE PREVENTION MODAL ══════════════════════ */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "linear-gradient(135deg, #fa8c16, #d46b08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <AuditOutlined style={{ color: "#fff", fontSize: 16 }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1a3353" }}>
                Trash Slide Prevention Measures
              </div>
              <div style={{ fontSize: 11, color: "#8c8c8c" }}>
                {trashSlideDetails.length} measure(s) recorded
              </div>
            </div>
          </div>
        }
        open={trashSlideModalOpen}
        onCancel={() => setTrashSlideModalOpen(false)}
        footer={[
          <Button
            key="add"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() =>
              setTrashSlideDetails((prev) => [
                ...prev,
                {
                  _key: Date.now(),
                  measure: "",
                  description: "",
                  status: "Implemented",
                  attachments: [],
                },
              ])
            }
          >
            Add Measure
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={facilityMgmtSaving}
            icon={<SaveOutlined />}
            onClick={() =>
              handleSaveFacilityDetails("trashSlide", trashSlideDetails)
            }
            style={{ background: "#fa8c16", borderColor: "#fa8c16" }}
          >
            Save
          </Button>,
          <Button key="close" onClick={() => setTrashSlideModalOpen(false)}>
            Close
          </Button>,
        ]}
        width={750}
        destroyOnHidden
      >
        {trashSlideDetails.length === 0 ? (
          <Empty
            description="No trash slide prevention measures yet. Click 'Add Measure' to start."
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          trashSlideDetails.map((item, idx) => (
            <div
              key={item._key}
              style={{
                background: "#fff7e6",
                borderRadius: 10,
                padding: 16,
                marginBottom: 12,
                border: "1px solid #ffd591",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <Tag color="orange" style={{ fontWeight: 700 }}>
                  Measure {idx + 1}
                </Tag>
                <Select
                  size="small"
                  value={item.status || "Implemented"}
                  onChange={(v) =>
                    setTrashSlideDetails((p) =>
                      p.map((x, i) => (i === idx ? { ...x, status: v } : x)),
                    )
                  }
                  options={[
                    { label: "Implemented", value: "Implemented" },
                    { label: "Planned", value: "Planned" },
                    { label: "Not Applicable", value: "Not Applicable" },
                  ]}
                  style={{ width: 160 }}
                />
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  style={{ marginLeft: "auto" }}
                  onClick={() =>
                    setTrashSlideDetails((p) => p.filter((_, i) => i !== idx))
                  }
                />
              </div>
              <Row gutter={[12, 8]}>
                <Col xs={24} sm={12}>
                  <div
                    style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                  >
                    Measure Name
                  </div>
                  <Input
                    size="small"
                    value={item.measure}
                    placeholder="e.g. Slope stabilization, Retaining wall..."
                    onChange={(e) =>
                      setTrashSlideDetails((p) =>
                        p.map((x, i) =>
                          i === idx ? { ...x, measure: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Col>
                <Col xs={24} sm={12}>
                  <div
                    style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                  >
                    Description
                  </div>
                  <Input
                    size="small"
                    value={item.description}
                    placeholder="Details, specifications..."
                    onChange={(e) =>
                      setTrashSlideDetails((p) =>
                        p.map((x, i) =>
                          i === idx ? { ...x, description: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Col>
              </Row>
              <div style={{ marginTop: 10 }}>
                <div
                  style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                >
                  Attachments / Document Links
                </div>
                {(item.attachments || []).map((url, ai) => (
                  <div
                    key={ai}
                    style={{ display: "flex", gap: 6, marginBottom: 6 }}
                  >
                    <Input
                      size="small"
                      value={url}
                      placeholder="Google Drive link or URL"
                      onChange={(e) =>
                        setTrashSlideDetails((p) =>
                          p.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  attachments: x.attachments.map((a, j) =>
                                    j === ai ? e.target.value : a,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                      addonBefore={<FileTextOutlined />}
                    />
                    {url && (
                      <Button
                        size="small"
                        type="link"
                        icon={<EyeOutlined />}
                        href={url}
                        target="_blank"
                        style={{ padding: 0 }}
                      />
                    )}
                    <Button
                      size="small"
                      danger
                      type="text"
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        setTrashSlideDetails((p) =>
                          p.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  attachments: x.attachments.filter(
                                    (_, j) => j !== ai,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
                <Button
                  size="small"
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() =>
                    setTrashSlideDetails((p) =>
                      p.map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              attachments: [...(x.attachments || []), ""],
                            }
                          : x,
                      ),
                    )
                  }
                >
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
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "linear-gradient(135deg, #ff4d4f, #cf1322)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <CloseCircleOutlined style={{ color: "#fff", fontSize: 16 }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1a3353" }}>
                Fire Prevention Measures
              </div>
              <div style={{ fontSize: 11, color: "#8c8c8c" }}>
                {firePrevDetails.length} measure(s) recorded
              </div>
            </div>
          </div>
        }
        open={firePrevModalOpen}
        onCancel={() => setFirePrevModalOpen(false)}
        footer={[
          <Button
            key="add"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() =>
              setFirePrevDetails((prev) => [
                ...prev,
                {
                  _key: Date.now(),
                  measure: "",
                  description: "",
                  status: "Implemented",
                  attachments: [],
                },
              ])
            }
          >
            Add Measure
          </Button>,
          <Button
            key="save"
            type="primary"
            danger
            loading={facilityMgmtSaving}
            icon={<SaveOutlined />}
            onClick={() =>
              handleSaveFacilityDetails("firePrev", firePrevDetails)
            }
          >
            Save
          </Button>,
          <Button key="close" onClick={() => setFirePrevModalOpen(false)}>
            Close
          </Button>,
        ]}
        width={750}
        destroyOnHidden
      >
        {firePrevDetails.length === 0 ? (
          <Empty
            description="No fire prevention measures yet. Click 'Add Measure' to start."
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          firePrevDetails.map((item, idx) => (
            <div
              key={item._key}
              style={{
                background: "#fff2f0",
                borderRadius: 10,
                padding: 16,
                marginBottom: 12,
                border: "1px solid #ffccc7",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <Tag color="red" style={{ fontWeight: 700 }}>
                  Measure {idx + 1}
                </Tag>
                <Select
                  size="small"
                  value={item.status || "Implemented"}
                  onChange={(v) =>
                    setFirePrevDetails((p) =>
                      p.map((x, i) => (i === idx ? { ...x, status: v } : x)),
                    )
                  }
                  options={[
                    { label: "Implemented", value: "Implemented" },
                    { label: "Planned", value: "Planned" },
                    { label: "Not Applicable", value: "Not Applicable" },
                  ]}
                  style={{ width: 160 }}
                />
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  style={{ marginLeft: "auto" }}
                  onClick={() =>
                    setFirePrevDetails((p) => p.filter((_, i) => i !== idx))
                  }
                />
              </div>
              <Row gutter={[12, 8]}>
                <Col xs={24} sm={12}>
                  <div
                    style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                  >
                    Measure Name
                  </div>
                  <Input
                    size="small"
                    value={item.measure}
                    placeholder="e.g. Fire suppression system, Firebreak..."
                    onChange={(e) =>
                      setFirePrevDetails((p) =>
                        p.map((x, i) =>
                          i === idx ? { ...x, measure: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Col>
                <Col xs={24} sm={12}>
                  <div
                    style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                  >
                    Description
                  </div>
                  <Input
                    size="small"
                    value={item.description}
                    placeholder="Details, specifications..."
                    onChange={(e) =>
                      setFirePrevDetails((p) =>
                        p.map((x, i) =>
                          i === idx ? { ...x, description: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Col>
              </Row>
              <div style={{ marginTop: 10 }}>
                <div
                  style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                >
                  Attachments / Document Links
                </div>
                {(item.attachments || []).map((url, ai) => (
                  <div
                    key={ai}
                    style={{ display: "flex", gap: 6, marginBottom: 6 }}
                  >
                    <Input
                      size="small"
                      value={url}
                      placeholder="Google Drive link or URL"
                      onChange={(e) =>
                        setFirePrevDetails((p) =>
                          p.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  attachments: x.attachments.map((a, j) =>
                                    j === ai ? e.target.value : a,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                      addonBefore={<FileTextOutlined />}
                    />
                    {url && (
                      <Button
                        size="small"
                        type="link"
                        icon={<EyeOutlined />}
                        href={url}
                        target="_blank"
                        style={{ padding: 0 }}
                      />
                    )}
                    <Button
                      size="small"
                      danger
                      type="text"
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        setFirePrevDetails((p) =>
                          p.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  attachments: x.attachments.filter(
                                    (_, j) => j !== ai,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
                <Button
                  size="small"
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() =>
                    setFirePrevDetails((p) =>
                      p.map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              attachments: [...(x.attachments || []), ""],
                            }
                          : x,
                      ),
                    )
                  }
                >
                  Add Link
                </Button>
              </div>
            </div>
          ))
        )}
      </Modal>
    </>
  );
}
