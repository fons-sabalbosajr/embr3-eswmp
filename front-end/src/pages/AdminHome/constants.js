// Static map/status presentation config + tiny pure derivations for the AdminHome
// dashboard. No React, no component state. Extracted from index.jsx so the map
// panels, calendar and dropdowns all read the same source of truth.
import L from "leaflet";
import { MAP_PRESENTATION, STATUS_PRESENTATION } from "../../utils/submissionStatus";
import {
  resolveMediaUrl,
  normalizeStoredFileUrl,
  getMediaKind,
} from "../admin/slf-monitoring/helpers.jsx";

export const STATUS_COLORS = {
  Approved: { bg: "#52c41a", icon: "✓" },
  "For Renewal": { bg: "#faad14", icon: "▲" },
  Other: { bg: "#8c8c8c", icon: "●" },
};

export const getPlanStatus = (forRenewal) => {
  if (!forRenewal) return "Other";
  if (/approved/i.test(forRenewal)) return "Approved";
  if (/renewal/i.test(forRenewal)) return "For Renewal";
  return "Other";
};

export const planStatusIcon = (forRenewal) => {
  const s = STATUS_COLORS[getPlanStatus(forRenewal)];
  return L.divIcon({
    className: "",
    html: `<div style="width:20px;height:20px;border-radius:50%;background:${s.bg};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:bold">${s.icon}</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -12],
  });
};

// Single SLF operational-status classifier. Mirrors the server aggregation
// (/slf-facilities/stats byStatus) so client counts can never drift from it.
export const classifySlfStatus = (status) => {
  const v = String(status || "");
  if (/operational/i.test(v) && !/non/i.test(v)) return "operational";
  if (/non/i.test(v)) return "nonOperational";
  return "unmonitored";
};

// First displayable photo for an SLF facility (map floating card). Photos live in
// the structured `galleryItems` ({url,...}); `galleryPhotos` is a legacy flat array.
// Walk both (structured first), skip non-image attachments (pdf/doc/video), and
// resolve Drive URLs to an optimized thumbnail via the shared resolver (never a
// hardcoded host). Returns "" when nothing usable exists so the caller shows a
// placeholder; broken URLs are caught by the <img> onError fallback at render time.
export const firstSlfPhoto = (record) => {
  const items = Array.isArray(record?.galleryItems) ? record.galleryItems : [];
  const legacy = Array.isArray(record?.galleryPhotos) ? record.galleryPhotos : [];
  for (const p of [...items, ...legacy]) {
    const raw =
      typeof p === "object" ? p?.url || p?.response?.url || "" : normalizeStoredFileUrl(p);
    if (!raw) continue;
    const kind = getMediaKind(raw);
    if (kind === "video" || kind === "pdf" || kind === "document") continue;
    const src = resolveMediaUrl(raw, { thumbnail: true });
    if (src) return src;
  }
  return "";
};

// SLF map marker states. When the map keys markers to each SLF's LATEST Disposal
// Calendar record (mode=latest), it uses the FULL workflow states so a marker
// matches the Disposal Activity calendar: acknowledged (blue pulse ✓), pending
// (yellow pulse ◷), pending-resubmission (orange pulse ↻), reverted (orange
// static ↺), rejected (red static ⊘), no-submission (gray static ○), and a
// distinct "no-data" fallback (light-gray –) for SLFs with no calendar record at
// all. Colours/glyphs come from the SHARED presentation config so the map, the
// calendar and the legend never diverge (no hard-coded per-SLF values).
export const MAP_MARKER = {
  acknowledged: { color: MAP_PRESENTATION.acknowledged.color, glyph: MAP_PRESENTATION.acknowledged.glyph, ring: "slf-today-ring" },
  pending: { color: MAP_PRESENTATION.pending.color, glyph: MAP_PRESENTATION.pending.glyph, ring: "slf-wait-ring" },
  "pending-resubmission": { color: MAP_PRESENTATION["pending-resubmission"].color, glyph: MAP_PRESENTATION["pending-resubmission"].glyph, ring: "slf-resub-ring" },
  reverted: { color: STATUS_PRESENTATION.reverted.color, glyph: "↺", ring: null },
  rejected: { color: STATUS_PRESENTATION.rejected.color, glyph: "⊘", ring: null },
  "no-submission": { color: MAP_PRESENTATION["no-submission"].color, glyph: MAP_PRESENTATION["no-submission"].glyph, ring: null },
  "no-data": { color: "#bfbfbf", glyph: "–", ring: null },
};

export const TILE_LAYERS = {
  street: {
    name: "Street",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  satellite: {
    name: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attr: "&copy; Esri, Maxar, Earthstar",
  },
  terrain: {
    name: "Terrain",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attr: "&copy; OpenTopoMap",
  },
  dark: {
    name: "Dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attr: "&copy; CARTO",
  },
};
