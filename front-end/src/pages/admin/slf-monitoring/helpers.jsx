import dayjs from 'dayjs';
import { Tag, Typography, Upload, message } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, SyncOutlined } from '@ant-design/icons';
import secureStorage from '../../../utils/secureStorage';
import { getAdminDisplayName } from '../../../utils/adminIdentity';
// Volume conversion lives in ONE place — see utils/volumeUnits.js. These are
// re-exported below so the existing `from './helpers'` imports keep working.
import {
  TON_PER_M3,
  normalizeUnit,
  convertVolume,
  convertVolumeSafe,
  resolveFacilityUnit,
  resolveCellUnit,
  formatVolume,
} from '../../../utils/volumeUnits';

const { Text } = Typography;

export const ACCENT = '#2f54eb';
export const CHART_COLORS = [
  '#2f54eb', '#52c41a', '#faad14', '#ff4d4f', '#13c2c2', '#722ed1', '#eb2f96',
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
  // SLF facility media is admin-side: upload it as restricted so it is encrypted
  // at rest (local) / kept off public Google Drive and served only through the
  // authenticated /secure media proxy. See server/routes/upload.js.
  data: { restricted: "true" },
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
      // Grid thumbnails are downscaled (w800) so many photos don't decode to
      // hundreds of MB in memory; full resolution is still used for preview/open.
      return thumbnail
        ? `https://drive.google.com/thumbnail?id=${id}&sz=w800`
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

export {
  managementStatusSummary,
  asStringArray,
  formatStringArray,
  normalizeUnit,
  normalizeCellStatus,
  isActiveCellStatus,
  isCompletedCellStatus,
  ACTIVE_VOLUME_STATUSES,
  TON_PER_M3,
  UNIT_OPTIONS,
  CELL_STATUS_OPTIONS,
  CELL_STATUS_COLORS,
  PERMIT_STATUS_OPTIONS,
  DP_TYPE_OPTIONS,
  WWTF_TYPE_OPTIONS,
  RECEIVING_FACILITY_TYPE_OPTIONS,
  GALLERY_COMPONENT_OPTIONS,
  getUploadHeaders,
  formatFileSize,
  getUploadFileSize,
  validateSlfUpload,
  renderSlfUploadItem,
  slfUploadProps,
  convertVolume,
  convertVolumeSafe,
  resolveFacilityUnit,
  resolveCellUnit,
  formatVolume,
  getWasteKind,
  isHazardousCellType,
  extractDriveId,
  isDriveUrl,
  resolveMediaUrl,
  normalizeStoredFileUrl,
};