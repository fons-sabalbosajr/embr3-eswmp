const express = require("express");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const {
  uploadFilePathToDrive,
  streamDriveFile,
  extractDriveFileId,
  getDriveFileMeta,
} = require("../utils/googleDrive");
const cache = require("../utils/serverCache");
const { MEDIA_META_PREFIX } = require("../utils/cacheKeys");
const {
  saveLocalUpload,
  resolveLocalUpload,
  readLocalUpload,
  isEncryptedUpload,
} = require("../utils/localUploadStorage");
const { signMediaRef, verifyMediaSignature } = require("../utils/mediaSecurity");
const { uploadSingle } = require("../utils/uploadErrorHandler");
const { authMiddleware } = require("../middleware/auth");
const { requireDriveActive } = require("../utils/driveMaintenanceGuard");
const { writeLog } = require("../utils/logger");

const router = express.Router();
const MAX_UPLOAD_MB = 200;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const UPLOAD_TMP_DIR = process.env.UPLOAD_TMP_DIR || path.join(os.tmpdir(), "embr3-eswmp-uploads");

const ADMIN_ROLES = new Set(["admin", "developer"]);

function getPublicApiBasePath() {
  return (process.env.PUBLIC_API_BASE_PATH || "/eswm-pipeline/api").replace(/\/+$/, "");
}

// Minimal extension → MIME map covering everything `fileFilter` accepts. The
// restricted-media proxy MUST send a real Content-Type: without one Express
// falls back to application/octet-stream, which makes browsers download a PDF
// instead of rendering it, breaking every in-app preview and thumbnail.
const MIME_BY_EXTENSION = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".svg": "image/svg+xml",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".csv": "text/csv",
  ".txt": "text/plain",
};

/**
 * Content type for a stored local file. Encrypted uploads keep their original
 * extension before the `.enc` suffix (see localUploadStorage.saveLocalUpload),
 * so the real type is recoverable without any extra bookkeeping.
 */
function mimeForStoredFile(fileName) {
  const withoutEnvelope = String(fileName || "").replace(/\.enc$/i, "");
  const extension = path.extname(withoutEnvelope).toLowerCase();
  return MIME_BY_EXTENSION[extension] || "application/octet-stream";
}

/** RFC 6266 inline disposition; keeps the original name for downloads. */
function setInlineDisposition(res, fileName) {
  const safe = String(fileName || "file").replace(/["\\\r\n]/g, "_");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
  );
}

// Build a signed, unguessable URL for restricted (admin-side) media. Browser
// <img> tags cannot send auth headers, so access is gated by this server-minted
// signature; the underlying Drive file is NOT public and local files are
// encrypted at rest. See utils/mediaSecurity.js.
//
// `originalName` is appended as a plain `name` query param. It is NOT part of
// the signed ref (so it cannot weaken or invalidate the signature) and exists
// purely so the stored URL is self-describing: the client can tell a PDF from
// an image without a round trip. Drive-backed refs are opaque file ids with no
// extension, which is exactly why previews used to fall back to "preview not
// available" for every restricted upload.
function buildSignedMediaUrl(kind, id, originalName = "") {
  const ref = `${kind}:${id}`;
  const sig = signMediaRef(ref);
  const encodedId = encodeURIComponent(id);
  const nameParam = originalName ? `&name=${encodeURIComponent(originalName)}` : "";
  return `${getPublicApiBasePath()}/upload/secure/${kind}/${encodedId}?sig=${sig}${nameParam}`;
}

// Authorize access to restricted media: either a valid server-minted signature,
// or a Bearer token belonging to an admin/developer (used by fetch/download
// flows). Portal users cannot reach restricted admin media.
function isAuthorizedForMedia(req, ref) {
  if (verifyMediaSignature(ref, req.query.sig, req.query.exp)) return true;
  const token = req.headers.authorization?.split(" ")[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (ADMIN_ROLES.has(decoded?.role)) return true;
    } catch {
      /* fall through to deny */
    }
  }
  return false;
}

// ── Public (unencrypted, portal-facing) local files ─────────────────────────
router.get("/files/:fileName", (req, res) => {
  try {
    // Encrypted (restricted) files are never served through the public route.
    if (isEncryptedUpload(req.params.fileName)) {
      return res.status(404).json({ message: "File not found" });
    }
    const filePath = resolveLocalUpload(req.params.fileName);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(filePath, (error) => {
      if (error && !res.headersSent) {
        res.status(error.statusCode === 404 ? 404 : 500).json({ message: "File not found" });
      }
    });
  } catch {
    res.status(400).json({ message: "Invalid file path" });
  }
});

// ── Restricted media proxy (admin/developer only, or valid signed URL) ───────
router.get("/secure/local/:fileName", async (req, res) => {
  const ref = `local:${req.params.fileName}`;
  if (!isAuthorizedForMedia(req, ref)) {
    return res.status(403).json({ message: "Not authorized to view this file." });
  }
  try {
    const buffer = await readLocalUpload(req.params.fileName);
    res.setHeader("Cache-Control", "private, max-age=3600");
    // Without an explicit type the browser downloads PDFs/images instead of
    // rendering them inline, which broke in-app previews and thumbnails.
    res.setHeader("Content-Type", mimeForStoredFile(req.params.fileName));
    setInlineDisposition(res, req.query.name || req.params.fileName.replace(/\.enc$/i, ""));
    res.send(buffer);
  } catch {
    res.status(404).json({ message: "File not found" });
  }
});

router.get("/secure/drive/:fileId", async (req, res) => {
  const fileId = extractDriveFileId(req.params.fileId) || req.params.fileId;
  const ref = `drive:${fileId}`;
  if (!isAuthorizedForMedia(req, ref)) {
    return res.status(403).json({ message: "Not authorized to view this file." });
  }
  try {
    res.setHeader("Cache-Control", "private, max-age=3600");
    // streamDriveFile sets Content-Type from Drive metadata; the inline
    // disposition keeps PDFs rendering in-page rather than downloading.
    if (req.query.name) setInlineDisposition(res, req.query.name);
    await streamDriveFile(fileId, res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ message: `Unable to load file: ${err.message}` });
    }
  }
});

/**
 * POST /api/upload/media-meta
 * Body: { urls: string[] }  →  { results: { [url]: { fileName, mimeType } } }
 *
 * Labels restricted media whose URL carries no file extension. New uploads embed
 * `?name=` (see buildSignedMediaUrl) and need no lookup; this exists for files
 * stored BEFORE that, where the proxy path is only an opaque Drive id. Resolved
 * in one batched call instead of one request per thumbnail, and memoised so a
 * gallery re-render does not re-hit Drive.
 */
const MEDIA_META_TTL_MS = 6 * 60 * 60 * 1000; // names/types never change for a stored file
const MEDIA_META_MAX_URLS = 200;

router.post("/media-meta", authMiddleware, async (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls.slice(0, MEDIA_META_MAX_URLS) : [];
  const results = {};

  const candidates = [];
  for (const url of urls) {
    if (typeof url !== "string" || !url) continue;

    // Local proxy refs already carry their extension in the stored file name.
    const localMatch = url.match(/\/upload\/secure\/local\/([^/?#]+)/);
    if (localMatch) {
      const fileName = decodeURIComponent(localMatch[1]).replace(/\.enc$/i, "");
      results[url] = { fileName, mimeType: mimeForStoredFile(fileName) };
      continue;
    }

    const driveMatch = url.match(/\/upload\/secure\/drive\/([^/?#]+)/);
    if (!driveMatch) continue;
    const fileId = decodeURIComponent(driveMatch[1]);
    candidates.push({ url, fileId, cacheKey: `${MEDIA_META_PREFIX}:${fileId}` });
  }

  // Resolve the cache for all candidates at once. Looking them up inside the loop
  // above would serialise up to MEDIA_META_MAX_URLS round trips once the cache is
  // Redis-backed rather than a synchronous in-process Map.
  const cachedMetas = await Promise.all(candidates.map((item) => cache.get(item.cacheKey).catch(() => undefined)));
  const pending = [];
  candidates.forEach((item, index) => {
    const cached = cachedMetas[index];
    if (cached) results[item.url] = cached;
    else pending.push(item);
  });

  // Bounded concurrency: a large gallery must not open 200 sockets to Drive.
  const CONCURRENCY = 8;
  for (let index = 0; index < pending.length; index += CONCURRENCY) {
    const slice = pending.slice(index, index + CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop -- deliberate throttling
    const metas = await Promise.all(slice.map((item) => getDriveFileMeta(item.fileId).catch(() => null)));
    metas.forEach((meta, offset) => {
      const item = slice[offset];
      if (!meta) return;
      const value = { fileName: meta.fileName, mimeType: meta.mimeType };
      cache.set(item.cacheKey, value, MEDIA_META_TTL_MS).catch(() => {});
      results[item.url] = value;
    });
  }

  res.json({ results });
});

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await fs.mkdir(UPLOAD_TMP_DIR, { recursive: true });
      cb(null, UPLOAD_TMP_DIR);
    } catch (error) {
      cb(error);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 12);
    cb(null, `${Date.now()}-${crypto.randomBytes(16).toString("hex")}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter(req, file, cb) {
    const allowed =
      file.mimetype.startsWith("image/") ||
      /^application\/(pdf|msword|vnd\.openxmlformats-officedocument\.(wordprocessingml|spreadsheetml|presentationml)\..+|vnd\.ms-excel|vnd\.ms-powerpoint)$/.test(
        file.mimetype
      ) ||
      file.mimetype === "text/plain";
    if (allowed) return cb(null, true);
    cb(new Error(`File type "${file.mimetype}" is not allowed.`));
  },
});

/**
 * POST /api/upload
 * Accepts a single file and stores it for later viewing/download.
 *
 * When `restricted` is truthy AND the uploader is an admin/developer, the file
 * becomes admin-side media: it is encrypted at rest (local) or stored WITHOUT a
 * public Drive permission, and is only reachable via a signed /secure proxy URL.
 * Portal uploads are never restricted (keeps portal media viewable).
 *
 * Returns: { url, fileId, name, mimeType, size, storage, restricted }
 */
router.post("/", authMiddleware, requireDriveActive, uploadSingle(upload, "file", { maxSizeMb: MAX_UPLOAD_MB }), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file provided." });
    }

    const wantsRestricted =
      String(req.body?.restricted ?? "").toLowerCase() === "true" ||
      req.body?.restricted === true;
    const restricted = wantsRestricted && ADMIN_ROLES.has(req.user?.role);

    const isImage = req.file.mimetype.startsWith("image/");
    let fileId = "";
    let viewUrl = "";
    let storage = "drive";

    if (restricted) {
      try {
        const driveResult = await uploadFilePathToDrive(
          req.file.path,
          req.file.mimetype,
          req.file.originalname,
          isImage,
          undefined,
          false // makePublic = false → private, served via proxy
        );
        fileId = driveResult.fileId;
        viewUrl = buildSignedMediaUrl("drive", fileId, req.file.originalname);
      } catch (driveErr) {
        console.warn(`Restricted Drive upload failed; storing encrypted locally: ${driveErr.message}`);
        writeLog("warn", "drive.upload.fallback", {
          message: `Restricted Drive upload failed; stored encrypted locally: ${driveErr.message}`,
          user: req.user?.email || req.user?.username || req.user?.id || "",
          ip: req.ip,
          meta: { restricted: true, storage: "local", driveErrorCode: driveErr.driveErrorCode || "unknown", retryable: !!driveErr.retryable, size: req.file.size },
        });
        const localResult = await saveLocalUpload(req.file, { encrypt: true });
        viewUrl = buildSignedMediaUrl("local", localResult.fileName, req.file.originalname);
        storage = "local";
      }
    } else {
      try {
        const driveResult = await uploadFilePathToDrive(
          req.file.path,
          req.file.mimetype,
          req.file.originalname,
          isImage
        );
        fileId = driveResult.fileId;
        viewUrl = driveResult.viewUrl;
      } catch (driveErr) {
        console.warn(`Drive upload failed; saving attachment locally instead: ${driveErr.message}`);
        writeLog("warn", "drive.upload.fallback", {
          message: `Drive upload failed; saved attachment locally: ${driveErr.message}`,
          user: req.user?.email || req.user?.username || req.user?.id || "",
          ip: req.ip,
          meta: { restricted: false, storage: "local", driveErrorCode: driveErr.driveErrorCode || "unknown", retryable: !!driveErr.retryable, size: req.file.size },
        });
        const localResult = await saveLocalUpload(req.file);
        viewUrl = localResult.url;
        storage = "local";
      }
    }

    res.json({
      url: viewUrl,
      fileId,
      name: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      storage,
      restricted,
    });
  } catch (err) {
    const isConfigError =
      err.message.includes("not configured") ||
      err.message.includes("Missing env vars");
    // A non-writable upload directory is an OPERATOR problem, not a transient one:
    // "please try again" is actively misleading because no number of retries can
    // fix directory ownership. Say what is actually wrong so it can be repaired.
    const isStorageError = err.code === "UPLOAD_DIR_NOT_WRITABLE";
    writeLog("error", "upload.failed", {
      message: `Upload failed: ${err.message}`,
      user: req.user?.email || req.user?.username || req.user?.id || "",
      ip: req.ip,
      meta: {
        driveErrorCode: err.driveErrorCode || null,
        storage: isStorageError ? "local-unwritable" : "unknown",
        uploadDir: err.uploadDir || undefined,
      },
    });
    if (isStorageError) {
      return res.status(500).json({
        message:
          "Upload failed: the server's file storage is not writable. This needs an administrator to fix — retrying will not help.",
        code: "UPLOAD_DIR_NOT_WRITABLE",
      });
    }
    res.status(isConfigError ? 503 : 500).json({ message: isConfigError ? err.message : "Upload failed. Please try again or contact support if the problem continues." });
  } finally {
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
  }
});

module.exports = router;
