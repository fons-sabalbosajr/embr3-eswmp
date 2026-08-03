const express = require("express");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const { uploadFileToDrive, streamDriveFile, extractDriveFileId } = require("../utils/googleDrive");
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
const DIRECT_LOCAL_UPLOAD_MB = 25;
const DIRECT_LOCAL_UPLOAD_BYTES = DIRECT_LOCAL_UPLOAD_MB * 1024 * 1024;

const ADMIN_ROLES = new Set(["admin", "developer"]);

function getPublicApiBasePath() {
  return (process.env.PUBLIC_API_BASE_PATH || "/eswm-pipeline/api").replace(/\/+$/, "");
}

// Build a signed, unguessable URL for restricted (admin-side) media. Browser
// <img> tags cannot send auth headers, so access is gated by this server-minted
// signature; the underlying Drive file is NOT public and local files are
// encrypted at rest. See utils/mediaSecurity.js.
function buildSignedMediaUrl(kind, id) {
  const ref = `${kind}:${id}`;
  const sig = signMediaRef(ref);
  const encodedId = encodeURIComponent(id);
  return `${getPublicApiBasePath()}/upload/secure/${kind}/${encodedId}?sig=${sig}`;
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
    await streamDriveFile(fileId, res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ message: `Unable to load file: ${err.message}` });
    }
  }
});

const storage = multer.memoryStorage();
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
      // Admin-side media: prefer encrypted local storage; fall back only within
      // local (never make a public Drive copy for restricted uploads).
      if (req.file.size >= DIRECT_LOCAL_UPLOAD_BYTES) {
        const localResult = await saveLocalUpload(req.file, { encrypt: true });
        viewUrl = buildSignedMediaUrl("local", localResult.fileName);
        storage = "local";
      } else {
        try {
          const driveResult = await uploadFileToDrive(
            req.file.buffer,
            req.file.mimetype,
            req.file.originalname,
            isImage,
            undefined,
            false // makePublic = false → private, served via proxy
          );
          fileId = driveResult.fileId;
          viewUrl = buildSignedMediaUrl("drive", fileId);
        } catch (driveErr) {
          console.warn(`Restricted Drive upload failed; storing encrypted locally: ${driveErr.message}`);
          writeLog("warn", "drive.upload.fallback", {
            message: `Restricted Drive upload failed; stored encrypted locally: ${driveErr.message}`,
            user: req.user?.email || req.user?.username || req.user?.id || "",
            ip: req.ip,
            meta: { restricted: true, storage: "local", driveErrorCode: driveErr.driveErrorCode || "unknown", retryable: !!driveErr.retryable },
          });
          const localResult = await saveLocalUpload(req.file, { encrypt: true });
          viewUrl = buildSignedMediaUrl("local", localResult.fileName);
          storage = "local";
        }
      }
    } else if (req.file.size >= DIRECT_LOCAL_UPLOAD_BYTES) {
      const localResult = await saveLocalUpload(req.file);
      viewUrl = localResult.url;
      storage = "local";
    } else {
      try {
        const driveResult = await uploadFileToDrive(
          req.file.buffer,
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
          meta: { restricted: false, storage: "local", driveErrorCode: driveErr.driveErrorCode || "unknown", retryable: !!driveErr.retryable },
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
    writeLog("error", "upload.failed", {
      message: `Upload failed: ${err.message}`,
      user: req.user?.email || req.user?.username || req.user?.id || "",
      ip: req.ip,
      meta: { driveErrorCode: err.driveErrorCode || null, storage: "unknown" },
    });
    res.status(isConfigError ? 503 : 500).json({ message: err.message });
  }
});

module.exports = router;
