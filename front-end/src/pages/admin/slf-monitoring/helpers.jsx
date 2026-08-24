import dayjs from 'dayjs';
import { Tag, Typography, Upload, message, Progress, Tooltip } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, SyncOutlined } from '@ant-design/icons';
import secureStorage from '../../../utils/secureStorage';
import { getEmbeddedMediaName } from '../../../utils/mediaFiles';
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
// "Not Required" marks a permit that legitimately does not apply to this facility.
// It is deliberately NOT a validity state: everything downstream must skip the
// expiry math for it rather than computing "Expired" from a missing date, which is
// what made not-applicable permits show alarming red tags. See isPermitNotRequired.
const PERMIT_STATUS_OPTIONS = [
  { label: "New", value: "New" },
  { label: "Renewal", value: "Renewal" },
  { label: "Not Required", value: "Not Required" },
];

// Single source of truth for the check, so the admin and portal renderers cannot
// drift. Tolerant of stored casing/spacing variants ("not required", "N/A").
const isPermitNotRequired = (status) =>
  /^(not[\s_-]*required|n\/?a)$/i.test(String(status || "").trim());

/**
 * A permit that has NOT been issued — distinct from one that is not required.
 *
 * Operators record two things in the permit-number field when there is no permit
 * to type: the word "None", or the application they have filed ("On going
 * application with application No. 347672", "Application No: 214898"). Both are
 * truthy strings, so the card treated them as a reference number, and because
 * neither carries a validity date `permitStatus` fell through to its
 * `statusText || "New / Complied"` branch and stamped a confident blue COMPLIED
 * badge on a facility that holds no permit at all.
 *
 * This is deliberately NOT folded into `isPermitNotRequired`: "not required"
 * means the permit does not apply and the card says so in words, whereas an
 * application in progress is a real obligation that is simply unmet. They render
 * differently — only the badge is suppressed here, so the application reference
 * the operator typed still shows.
 *
 * Lives beside its sibling for the same reason that one does: the admin and
 * portal renderers must not drift.
 */
const isPermitNotIssued = (value) => {
  const text = String(value || "").trim();
  if (!text) return false;
  return /^(none|nil|wala)$/i.test(text) || /^(on[\s_-]*going|ongoing|application\s*no)\b/i.test(text);
};
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
export const GALLERY_COMPONENT_OPTIONS = [
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

const uploadPercent = (file) =>
  Math.max(0, Math.min(100, Math.round(Number(file?.percent) || 0)));

const renderSlfUploadItem = (originNode, file) => {
  const sizeText = formatFileSize(getUploadFileSize(file));
  const uploading = file?.status === "uploading";
  const percent = uploadPercent(file);
  if (!sizeText && !uploading) return originNode;
  return (
    <div className="slf-upload-list-item">
      {originNode}
      {uploading && (
        <Progress
          percent={percent}
          size="small"
          status="active"
          style={{ marginTop: 2, marginBottom: 0 }}
        />
      )}
      <Text
        type="secondary"
        style={{ display: "block", fontSize: 11, lineHeight: 1.3, marginTop: 2 }}
      >
        {sizeText}
        {uploading ? `${sizeText ? " " : ""}- ${percent}%` : ""}
      </Text>
    </div>
  );
};

// Upload feedback for the SINGLE-file tables (SLF Documents / Gallery). Those set
// showUploadList={false}, so a row's Status cell is the only place an upload can
// show itself — and it previously showed a bare "Uploading" tag with no indication
// of progress, which against a 200 MB limit is a long blind wait with no way to
// tell a slow transfer from a stalled one.
const renderUploadStatusCell = (file, url) => {
  if (file?.status === "uploading") {
    const percent = uploadPercent(file);
    return (
      <Tooltip title={`Uploading${file?.name ? ` ${file.name}` : ""} — ${percent}%`}>
        <div style={{ minWidth: 74 }}>
          <Progress percent={percent} size="small" status="active" />
        </div>
      </Tooltip>
    );
  }
  const label = file?.status === "error" ? "Error" : url ? "Ready" : "Missing";
  const color = file?.status === "error" ? "red" : url ? "green" : "default";
  return <Tag color={color}>{label}</Tag>;
};

// Antd's Form.Item clones its child and injects its OWN `onChange`, so any
// onChange passed to <Upload> inside a Form.Item is discarded. `getValueFromEvent`
// is therefore the only place that sees the raw upload event, which makes it the
// only place upload feedback can be raised from. Without this, the Documents and
// Gallery tables (which set showUploadList={false}) reported nothing at all — a
// failed upload looked exactly like no upload, so admins had no way to tell that
// a file had not been attached.
const uploadEventToFileList = (e) => {
  if (Array.isArray(e)) return e;
  const file = e?.file;
  if (file?.status === "done") {
    message.success(`${file.name} uploaded.`);
  } else if (file?.status === "error") {
    const reason =
      file.response?.message ||
      file.error?.message ||
      "The server rejected the upload.";
    message.error(`${file.name} was not uploaded. ${reason}`);
  }
  return e?.fileList;
};

export const slfUploadProps = {
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

// Resolve a stored media URL into an IMAGE source usable by <img>/<Image>.
// Google Drive "webViewLink" values are viewer pages and cannot be used as an
// image source. Google also deprecated the `uc?export=view` endpoint (it now
// serves a scan-warning interstitial for many files, which is what left gallery
// previews broken); the `thumbnail` endpoint renders reliably as an <img> at any
// size, so it is used for both grid thumbnails (w800) and the full preview
// (w1600).
export const resolveMediaUrl = (url, { thumbnail = false } = {}) => {
  const s = String(url || "");
  if (!s) return "";
  if (isDriveUrl(s)) {
    const id = extractDriveId(s);
    if (id) {
      return thumbnail
        ? `https://drive.google.com/thumbnail?id=${id}&sz=w800`
        : `https://drive.google.com/thumbnail?id=${id}&sz=w1600`;
    }
  }
  return s;
};

// Resolve a URL that reliably OPENS a stored file in a new tab regardless of
// type (image / video / pdf / doc). Drive files open in their native viewer
// page — which handles every file type — instead of the broken direct-download
// endpoint. Use this for every "View" / "Open in new tab" action.
const resolveMediaOpenUrl = (url) => {
  const s = String(url || "");
  if (!s) return "";
  if (isDriveUrl(s)) {
    const id = extractDriveId(s);
    if (id) return `https://drive.google.com/file/d/${id}/view`;
  }
  return s;
};

// Resolve a URL that EMBEDS a stored file inside an <iframe> for in-app preview.
// Drive files use their `/preview` embed page, which renders pdf/doc/image inline
// without a download; everything else embeds by its direct URL.
const resolveMediaPreviewUrl = (url) => {
  const s = String(url || "");
  if (!s) return "";
  if (isDriveUrl(s)) {
    const id = extractDriveId(s);
    if (id) return `https://drive.google.com/file/d/${id}/preview`;
  }
  return s;
};

// Coarse media-type detection from a URL/extension, for choosing how to render
// a stored file (inline image vs. video vs. pdf vs. generic download).
const getMediaKind = (url) => {
  const s = String(url || "").split("?")[0].split("#")[0].toLowerCase();
  if (/\.(jpe?g|png|gif|webp|bmp|svg|avif|heic)$/.test(s)) return "image";
  if (/\.(mp4|webm|ogg|mov|m4v|avi|mkv)$/.test(s)) return "video";
  if (/\.pdf$/.test(s)) return "pdf";
  if (/\.(docx?|xlsx?|pptx?|csv|txt)$/.test(s)) return "document";
  // Drive URLs and other extension-less links: treat as generic (openable).
  return "file";
};

const normalizeStoredFileUrl = (value) => {
  if (!value) return "";
  if (Array.isArray(value))
    return value[0]?.response?.url || value[0]?.url || value[0] || "";
  if (typeof value === "object") return value.response?.url || value.url || "";
  return value;
};

export const SLF_DOCUMENT_TYPE_OPTIONS = [
  { label: "ECC", value: "ECC" },
  { label: "Permit", value: "Permit" },
  { label: "Monitoring Report", value: "Monitoring Report" },
  { label: "Compliance Certificate", value: "Compliance Certificate" },
  { label: "Site Plan", value: "Site Plan" },
  { label: "Other", value: "Other" },
];

export const fileNameFromUrl = (value, fallback = "file") => {
  const first = Array.isArray(value) ? value[0] : null;
  const raw = first?.url || (typeof value === "string" ? value : "");
  // Our secure proxy + Google Drive URLs end in an OPAQUE file ID, never a
  // human filename — surfacing that as the name is the "random name" bug. Prefer
  // the fileList item's own name; otherwise use the caller's fallback.
  if (
    /\/upload\/secure\/(drive|local)\//.test(raw) ||
    /drive\.google\.com|googleusercontent/.test(raw)
  ) {
    // Newly-minted signed URLs embed the ORIGINAL filename as ?name=; reading it
    // is what stops a stored file with no fileList entry from falling all the way
    // through to the generic fallback.
    return first?.name || getEmbeddedMediaName(raw) || fallback;
  }
  const src = raw || first?.name || "";
  if (!src) return fallback;
  try {
    const pathname = new URL(src, window.location.origin).pathname;
    return decodeURIComponent(pathname.split("/").pop() || fallback);
  } catch {
    return String(src).split("/").pop() || fallback;
  }
};

// The upload response returns the ORIGINAL filename (server sends
// `name: req.file.originalname`); AntD also keeps it on `file.name` for the life
// of the fileList item. Prefer the fresh response name, then the persisted
// `fileName`, then AntD's own item name — only then derive from the URL (which
// for restricted Drive/local media is an opaque id, never a real filename).
export const resolveUploadName = (value, persistedName, fallback = "file") => {
  const file = Array.isArray(value) ? value[0] : null;
  const freshName = file?.response?.name || "";
  return (
    freshName || persistedName || file?.name || fileNameFromUrl(value, fallback)
  );
};

export const uploadFileFromValue = (value) =>
  Array.isArray(value) ? value[0] : null;
export const fileUrlFromValue = (value) =>
  uploadFileFromValue(value)?.url ||
  uploadFileFromValue(value)?.response?.url ||
  (typeof value === "string" ? value : "");

export const THREE_DECIMAL_STEP = 0.001;
export const formatThreeDecimalInput = (value) =>
  value === "" || value === null || value === undefined
    ? ""
    : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
export const parseDecimalInput = (value) => {
  const cleaned = String(value ?? "").replace(/,/g, "");
  return cleaned === "" ? null : cleaned;
};

export const getServedClientCount = (record = {}) => {
  const lguList = Array.isArray(record.lguServedList) ? record.lguServedList.filter(Boolean) : [];
  const privateList = Array.isArray(record.privateCompaniesServed) ? record.privateCompaniesServed.filter(Boolean) : [];
  if (/private/i.test(record.ownership || "")) {
    return privateList.length || Number(record.noOfLGUServed || 0);
  }
  return lguList.length || Number(record.noOfLGUServed || 0);
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
  isPermitNotRequired,
  isPermitNotIssued,
  DP_TYPE_OPTIONS,
  WWTF_TYPE_OPTIONS,
  RECEIVING_FACILITY_TYPE_OPTIONS,
  getUploadHeaders,
  formatFileSize,
  getUploadFileSize,
  validateSlfUpload,
  renderSlfUploadItem,
  renderUploadStatusCell,
  uploadEventToFileList,
  convertVolume,
  convertVolumeSafe,
  resolveFacilityUnit,
  resolveCellUnit,
  formatVolume,
  getWasteKind,
  isHazardousCellType,
  extractDriveId,
  isDriveUrl,
  resolveMediaOpenUrl,
  resolveMediaPreviewUrl,
  getMediaKind,
  normalizeStoredFileUrl,
};