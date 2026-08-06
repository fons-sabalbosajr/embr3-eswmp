// Identify and render stored media (uploads) correctly, regardless of how the
// file was stored.
//
// The app stores three URL shapes and they behave very differently:
//
//   1. Public Google Drive links      — https://drive.google.com/file/d/<id>/view
//   2. Restricted proxy links (admin) — /eswm-pipeline/api/upload/secure/drive/<id>?sig=…
//                                       /eswm-pipeline/api/upload/secure/local/<name>.enc?sig=…
//   3. Plain local links              — /eswm-pipeline/api/upload/files/<name>.pdf
//
// Shape 2 is what every SLF facility upload produces (slfUploadProps sends
// `restricted: true`). Its path ends in an opaque Drive id or an `.enc` envelope,
// so extension sniffing — which is all the previous code did — reported "file"
// for every restricted PDF. That single misdetection is why preventive-measure
// PDFs rendered "Preview is not available for this file type" and why their
// thumbnails were blank.
//
// Resolution order for a file's real name, cheapest first:
//   a. a name the caller already holds (preventiveMeasureFileDetails.fileName…)
//   b. the `?name=` parameter embedded in newly-minted signed URLs
//   c. the stored local file name with its `.enc` envelope stripped
//   d. a batched server lookup (see fetchMediaMeta) for legacy Drive proxy URLs

import api from "../api";

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|tiff?)$/i;
const VIDEO_EXT = /\.(mp4|webm|ogg|mov|m4v|avi|mkv)$/i;
const PDF_EXT = /\.pdf$/i;
const WORD_EXT = /\.(docx?|rtf|odt)$/i;
const SHEET_EXT = /\.(xlsx?|csv|ods)$/i;
const SLIDE_EXT = /\.(pptx?|odp)$/i;

const DRIVE_HOST = /drive\.google\.com|googleusercontent\.com|docs\.google\.com/;
const SECURE_DRIVE_PATH = /\/upload\/secure\/drive\/([^/?#]+)/;
const SECURE_LOCAL_PATH = /\/upload\/secure\/local\/([^/?#]+)/;

/** Extract a Google Drive file id from any of its URL shapes. */
export function extractDriveId(url) {
  const value = String(url || "");
  return (
    value.match(/\/file\/d\/([^/?#]+)/)?.[1] ||
    value.match(/[?&]id=([^&#]+)/)?.[1] ||
    value.match(/\/d\/([^/?#]+)/)?.[1] ||
    ""
  );
}

export const isDriveUrl = (url) => DRIVE_HOST.test(String(url || ""));

/** True for the authenticated /upload/secure proxy (same-origin, signed). */
export const isSecureProxyUrl = (url) =>
  SECURE_DRIVE_PATH.test(String(url || "")) || SECURE_LOCAL_PATH.test(String(url || ""));

function readQueryParam(url, key) {
  const query = String(url || "").split("?")[1];
  if (!query) return "";
  for (const pair of query.split("&")) {
    const [name, value = ""] = pair.split("=");
    if (name === key) {
      try {
        return decodeURIComponent(value.replace(/\+/g, " "));
      } catch {
        return value;
      }
    }
  }
  return "";
}

/**
 * Best-known display name for a stored file.
 * @param {string} url
 * @param {string} [knownName] a name the caller already has (always wins)
 */
export function getMediaFileName(url, knownName = "") {
  if (knownName) return knownName;

  const embedded = readQueryParam(url, "name");
  if (embedded) return embedded;

  const localMatch = String(url || "").match(SECURE_LOCAL_PATH);
  if (localMatch) {
    try {
      return decodeURIComponent(localMatch[1]).replace(/\.enc$/i, "");
    } catch {
      return localMatch[1].replace(/\.enc$/i, "");
    }
  }

  const path = String(url || "").split("?")[0].split("#")[0];
  try {
    return decodeURIComponent(path.split("/").pop() || "") || "document";
  } catch {
    return path.split("/").pop() || "document";
  }
}

/**
 * Coarse media kind used to pick a renderer.
 * @returns {"image"|"video"|"pdf"|"word"|"sheet"|"slide"|"file"}
 */
export function getMediaKind(url, knownName = "", mimeType = "") {
  if (mimeType) {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType === "application/pdf") return "pdf";
    if (/wordprocessingml|msword/.test(mimeType)) return "word";
    if (/spreadsheetml|ms-excel|csv/.test(mimeType)) return "sheet";
    if (/presentationml|ms-powerpoint/.test(mimeType)) return "slide";
  }

  const name = getMediaFileName(url, knownName);
  if (IMAGE_EXT.test(name)) return "image";
  if (VIDEO_EXT.test(name)) return "video";
  if (PDF_EXT.test(name)) return "pdf";
  if (WORD_EXT.test(name)) return "word";
  if (SHEET_EXT.test(name)) return "sheet";
  if (SLIDE_EXT.test(name)) return "slide";
  return "file";
}

/**
 * True when the kind cannot be determined locally and a server lookup would
 * help — i.e. a legacy restricted Drive URL with no embedded name.
 */
export function needsMediaMeta(url, knownName = "") {
  if (knownName || readQueryParam(url, "name")) return false;
  return SECURE_DRIVE_PATH.test(String(url || ""));
}

/** URL that reliably OPENS the file in a new tab. */
export function resolveMediaOpenUrl(url) {
  const value = String(url || "");
  if (!value) return "";
  if (isDriveUrl(value)) {
    const id = extractDriveId(value);
    if (id) return `https://drive.google.com/file/d/${id}/view`;
  }
  return value;
}

/**
 * URL that can be EMBEDDED in an <iframe>.
 *
 * Google's `/view` page sends X-Frame-Options and refuses to frame, so pointing
 * an iframe at it yields a blank panel — that was the second half of the broken
 * PDF preview. `/preview` is the embeddable variant. Same-origin proxy URLs
 * embed directly now that the proxy sends a real Content-Type.
 */
export function resolveMediaEmbedUrl(url) {
  const value = String(url || "");
  if (!value) return "";
  if (isDriveUrl(value)) {
    const id = extractDriveId(value);
    if (id) return `https://drive.google.com/file/d/${id}/preview`;
  }
  return value;
}

/** Image source for a stored file (thumbnails and full-size previews). */
export function resolveMediaImageUrl(url, { thumbnail = false } = {}) {
  const value = String(url || "");
  if (!value) return "";
  if (isDriveUrl(value)) {
    const id = extractDriveId(value);
    // Drive's `uc?export=view` endpoint now serves a scan-warning interstitial;
    // the thumbnail endpoint renders reliably as an <img> at any size AND
    // renders a first-page raster for PDFs.
    if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=${thumbnail ? "w400" : "w1600"}`;
  }
  return value;
}

// ── Batched metadata lookup ────────────────────────────────────────────────
//
// Legacy restricted Drive URLs carry no name. Rather than one request per tile
// (a 60-file gallery meant 60 round trips), unresolved URLs are collected and
// resolved in a single POST, then memoised for the session.

const metaCache = new Map(); // url -> { fileName, mimeType }
const metaInFlight = new Map(); // url -> Promise

/**
 * Resolve display metadata for the given URLs.
 * Cached and de-duplicated; never rejects (callers degrade to extension sniffing).
 * @returns {Promise<Record<string, {fileName: string, mimeType: string}>>}
 */
export async function fetchMediaMeta(urls = []) {
  const wanted = [...new Set(urls.filter(Boolean))];
  const resolved = {};
  const missing = [];

  for (const url of wanted) {
    if (metaCache.has(url)) resolved[url] = metaCache.get(url);
    else if (!metaInFlight.has(url)) missing.push(url);
  }

  // Await any lookup already in flight for these URLs so callers see one result.
  const pendingPromises = wanted.map((url) => metaInFlight.get(url)).filter(Boolean);

  if (missing.length) {
    const request = api
      .post("/upload/media-meta", { urls: missing })
      .then(({ data }) => {
        const results = data?.results || {};
        missing.forEach((url) => {
          // Cache negatives too: a file the server cannot describe must not be
          // re-requested on every re-render.
          metaCache.set(url, results[url] || { fileName: "", mimeType: "" });
        });
      })
      .catch(() => {
        missing.forEach((url) => metaCache.set(url, { fileName: "", mimeType: "" }));
      })
      .finally(() => {
        missing.forEach((url) => metaInFlight.delete(url));
      });

    missing.forEach((url) => metaInFlight.set(url, request));
    pendingPromises.push(request);
  }

  await Promise.all(pendingPromises);
  wanted.forEach((url) => {
    if (metaCache.has(url)) resolved[url] = metaCache.get(url);
  });
  return resolved;
}

/** Synchronous read of anything already resolved (no request). */
export const getCachedMediaMeta = (url) => metaCache.get(url) || null;
