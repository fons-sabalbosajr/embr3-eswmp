// Profile pictures for admin users (User) and portal users (UserPortal).
//
//   POST   /api/profile-photo   multipart field "photo" (JPEG/PNG/WebP, ≤ 5 MB)
//   DELETE /api/profile-photo   remove the picture
//
// Storage: the Google Drive IMAGES folder (GDRIVE_IMAGE_FOLDER_ID), inside a
// "Profile Pictures" subfolder created on first use. Files are uploaded PRIVATE
// (no "anyone with the link" permission) and shown through the existing signed
// media proxy (/upload/secure/drive/:id?sig=…), since an <img> cannot send an
// Authorization header. When Drive is unavailable or in maintenance mode, the
// picture is stored encrypted on the server instead, served the same way.
//
// The caller can only ever change their OWN picture: the account comes from the
// token, never from the request. A developer working inside a portal user's
// context (devPortal token with portalContextUserId) is refused, so the portal
// account's picture is never changed on someone else's behalf.

const express = require("express");
const multer = require("multer");
const { requireAnyAuth } = require("../middleware/auth");
const { uploadSingle } = require("../utils/uploadErrorHandler");
const { uploadFileToDrive, ensureDriveSubfolder, trashDriveFile } = require("../utils/googleDrive");
const { getDriveMaintenanceState } = require("../utils/driveMaintenanceGuard");
const { saveLocalUpload, resolveLocalUpload } = require("../utils/localUploadStorage");
const { signMediaRef } = require("../utils/mediaSecurity");
const { writeLog } = require("../utils/logger");

const router = express.Router();

const MAX_MB = 5;
const PROFILE_FOLDER_NAME = process.env.GDRIVE_PROFILE_FOLDER_NAME || "Profile Pictures";
const ALLOWED = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    if (ALLOWED[file.mimetype]) return cb(null, true);
    cb(new Error("Only JPEG, PNG or WebP images can be used as a profile picture."));
  },
});

// The declared type must match the bytes: a renamed file is refused.
function sniffImageType(buf) {
  if (!buf || buf.length < 12) return "";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "";
}

const apiBase = () => (process.env.PUBLIC_API_BASE_PATH || "/eswm-pipeline/api").replace(/\/+$/, "");
// Same signed proxy URLs the upload route mints (routes/upload.js). `v` only
// busts the browser cache after a change; it is not part of the signature.
function signedUrl(kind, id, version) {
  const sig = signMediaRef(`${kind}:${id}`);
  return `${apiBase()}/upload/secure/${kind}/${encodeURIComponent(id)}?sig=${sig}&v=${version}`;
}

function accountModel(req) {
  return req.user?.role === "portal_user" ? require("../models/UserPortal") : require("../models/User");
}

function refuseOtherContexts(req, res) {
  if (req.user?.portalContextUserId) {
    res.status(403).json({ message: "A profile picture can only be changed by the account holder, not from a developer portal context." });
    return true;
  }
  if (!req.user?.id) {
    res.status(401).json({ message: "Sign in again to change your profile picture." });
    return true;
  }
  return false;
}

async function removeStored(photo) {
  if (!photo?.fileRef) return;
  if (photo.storage === "drive") {
    await trashDriveFile(photo.fileRef).catch(() => false);
  } else if (photo.storage === "local") {
    try {
      await require("fs/promises").unlink(resolveLocalUpload(photo.fileRef));
    } catch { /* already gone */ }
  }
}

const publicShape = (photo) => ({ url: photo?.url || "", updatedAt: photo?.updatedAt || null });

router.post("/", requireAnyAuth, uploadSingle(upload, "photo", { maxSizeMb: MAX_MB }), async (req, res) => {
  if (refuseOtherContexts(req, res)) return;
  if (!req.file) return res.status(400).json({ message: "Choose an image to upload." });
  const sniffed = sniffImageType(req.file.buffer);
  if (!sniffed || sniffed !== req.file.mimetype) {
    return res.status(400).json({ message: "That file is not a valid JPEG, PNG or WebP image." });
  }

  const Model = accountModel(req);
  const account = await Model.findById(req.user.id).select("profilePhoto email").catch(() => null);
  if (!account) return res.status(404).json({ message: "Account not found." });

  const realm = req.user.role === "portal_user" ? "portal" : "admin";
  const version = Date.now();
  const fileName = `${realm}-${account._id}-${version}.${ALLOWED[sniffed]}`;
  const actor = account.email || String(account._id);

  let storage = "drive";
  let fileRef = "";
  let url = "";
  try {
    const { mode } = await getDriveMaintenanceState();
    if (mode) throw Object.assign(new Error("Google Drive is in maintenance mode"), { driveErrorCode: "maintenance" });
    const folderId = await ensureDriveSubfolder(process.env.GDRIVE_IMAGE_FOLDER_ID, PROFILE_FOLDER_NAME);
    const result = await uploadFileToDrive(req.file.buffer, sniffed, fileName, true, folderId, false);
    fileRef = result.fileId;
    url = signedUrl("drive", fileRef, version);
  } catch (driveErr) {
    writeLog("warn", "profile-photo.drive-fallback", {
      message: `Profile picture stored locally (encrypted): ${driveErr.message}`,
      user: actor,
      meta: { driveErrorCode: driveErr.driveErrorCode || "unknown" },
    });
    try {
      const local = await saveLocalUpload({ ...req.file, originalname: fileName }, { encrypt: true });
      storage = "local";
      fileRef = local.fileName;
      url = signedUrl("local", fileRef, version);
    } catch (localErr) {
      writeLog("error", "profile-photo.failed", { message: `Profile picture upload failed: ${localErr.message}`, user: actor });
      return res.status(500).json({ message: "The picture could not be saved. Please try again later." });
    }
  }

  const previous = account.profilePhoto ? { ...account.profilePhoto.toObject?.() ?? account.profilePhoto } : null;
  account.profilePhoto = { url, storage, fileRef, updatedAt: new Date(version) };
  await account.save();
  // The old picture is removed only once the new one is saved.
  removeStored(previous);

  writeLog("info", "profile-photo.updated", { message: "Profile picture updated", user: actor, meta: { realm, storage } });
  res.json({ message: "Profile picture updated.", profilePhoto: publicShape(account.profilePhoto) });
});

router.delete("/", requireAnyAuth, async (req, res) => {
  if (refuseOtherContexts(req, res)) return;
  const Model = accountModel(req);
  const account = await Model.findById(req.user.id).select("profilePhoto email").catch(() => null);
  if (!account) return res.status(404).json({ message: "Account not found." });
  const previous = account.profilePhoto ? { ...account.profilePhoto.toObject?.() ?? account.profilePhoto } : null;
  account.profilePhoto = { url: "", storage: "", fileRef: "", updatedAt: new Date() };
  await account.save();
  removeStored(previous);
  writeLog("info", "profile-photo.removed", { message: "Profile picture removed", user: account.email || String(account._id) });
  res.json({ message: "Profile picture removed.", profilePhoto: publicShape(account.profilePhoto) });
});

module.exports = router;
module.exports._test = { sniffImageType, signedUrl };
