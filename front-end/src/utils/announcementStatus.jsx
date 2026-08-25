import {
  EditOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  StopOutlined,
  PauseCircleOutlined,
  InfoCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons";

// ── Centralized announcement status logic ────────────────────────────────────
// The ONE place that decides an announcement's lifecycle status. Every surface
// (summary cards, table badge, filters, action availability, view modal) calls
// resolveAnnouncementStatus — status conditions are never duplicated.
//
// Status is derived from the saved `enabled` flag + publish/expiration dates +
// the current time. All comparisons use epoch milliseconds (UTC-consistent),
// so stored ISO dates and `Date.now()` compare correctly regardless of the
// viewer's local timezone.
//
//   enabled  window vs now                     → status
//   ───────  ───────────────────────────────    ─────────────
//   true     now < startAt                     → scheduled
//   true     endAt && now > endAt              → expired
//   true     otherwise                         → active
//   false    endAt && now > endAt              → expired
//   false    startAt && now >= startAt         → unpublished (window reached, toggled off)
//   false    otherwise                         → draft

// The pure lifecycle rules — resolveAnnouncementStatus, selectLatestAnnouncement
// and ANNOUNCEMENT_STATUSES — live in ./announcementLifecycle.js, which holds no
// JSX and so can be imported by the test suite (plain Node cannot load JSX).
// This module keeps only the PRESENTATION: labels, antd Tag colours and icons.
// Deliberately not re-exported from here — a re-export makes every export in the
// file opaque to react-refresh, which then flags the whole module.

// Presentation for each status — label, antd Tag color, and an icon.
export const ANNOUNCEMENT_STATUS_META = {
  draft: { label: "Draft", color: "default", icon: <EditOutlined /> },
  scheduled: { label: "Scheduled", color: "blue", icon: <ClockCircleOutlined /> },
  active: { label: "Active", color: "green", icon: <CheckCircleOutlined /> },
  unpublished: { label: "Unpublished", color: "orange", icon: <PauseCircleOutlined /> },
  expired: { label: "Expired", color: "default", icon: <StopOutlined /> },
};

export function statusMeta(status) {
  return ANNOUNCEMENT_STATUS_META[status] || ANNOUNCEMENT_STATUS_META.draft;
}

// ── Type / category ──────────────────────────────────────────────────────────
export const ANNOUNCEMENT_TYPE_META = {
  info: { label: "Information", color: "blue", icon: <InfoCircleOutlined /> },
  success: { label: "Success", color: "green", icon: <CheckCircleOutlined /> },
  warning: { label: "Warning", color: "orange", icon: <WarningOutlined /> },
  error: { label: "Critical", color: "red", icon: <CloseCircleOutlined /> },
};
export function typeMeta(type) {
  return ANNOUNCEMENT_TYPE_META[type] || ANNOUNCEMENT_TYPE_META.info;
}

// ── Priority ─────────────────────────────────────────────────────────────────
export const ANNOUNCEMENT_PRIORITY_META = {
  low: { label: "Low", color: "default" },
  normal: { label: "Normal", color: "blue" },
  high: { label: "High", color: "orange" },
  urgent: { label: "Urgent", color: "red" },
};
export function priorityMeta(priority) {
  return ANNOUNCEMENT_PRIORITY_META[priority] || ANNOUNCEMENT_PRIORITY_META.normal;
}

// ── Audience (derived from placement flags) ──────────────────────────────────
// The schema has no `audience` field; audience is the combination of where the
// announcement shows (login screen / inside the portal).
export function resolveAudience(a) {
  const login = a?.showOnLogin !== false;
  const portal = a?.showInPortal !== false;
  if (login && portal) return { key: "both", label: "Login + Portal" };
  if (login) return { key: "login", label: "Login screen" };
  if (portal) return { key: "portal", label: "In-portal" };
  return { key: "hidden", label: "Hidden" };
}
export const AUDIENCE_FILTER_OPTIONS = [
  { value: "both", label: "Login + Portal" },
  { value: "login", label: "Login screen" },
  { value: "portal", label: "In-portal" },
  { value: "hidden", label: "Hidden" },
];
