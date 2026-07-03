const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { ENCRYPTED_SUFFIX, encryptBuffer, decryptBuffer } = require("./mediaSecurity");

const DEFAULT_UPLOAD_DIR = path.join(__dirname, "..", "uploads", "files");

function getUploadDir() {
  const configuredDir = process.env.FILE_UPLOAD_DIR;
  if (configuredDir && configuredDir.trim() !== "") {
    return path.isAbsolute(configuredDir)
      ? configuredDir
      : path.resolve(process.cwd(), configuredDir);
  }
  return DEFAULT_UPLOAD_DIR;
}

function getPublicApiBasePath() {
  return (process.env.PUBLIC_API_BASE_PATH || "/eswm-pipeline/api").replace(/\/+$/, "");
}

function getSafeExtension(originalName) {
  const extension = path.extname(originalName || "").toLowerCase();
  return /^[.][a-z0-9]{1,10}$/.test(extension) ? extension : "";
}

function getLocalUploadUrl(fileName) {
  return `${getPublicApiBasePath()}/upload/files/${encodeURIComponent(fileName)}`;
}

/**
 * Persist an uploaded file to local storage.
 * @param {object} file - multer file ({ buffer, originalname })
 * @param {object} [opts]
 * @param {boolean} [opts.encrypt] - encrypt the file at rest (restricted media)
 * @returns {{ fileName, filePath, url, encrypted }}
 *   `url` is only returned for public (unencrypted) files; encrypted files are
 *   served exclusively through the authenticated /media route (caller builds it).
 */
async function saveLocalUpload(file, opts = {}) {
  const uploadDir = getUploadDir();
  await fs.mkdir(uploadDir, { recursive: true });

  const encrypt = Boolean(opts.encrypt);
  const baseName = `${Date.now()}-${crypto.randomBytes(16).toString("hex")}${getSafeExtension(file.originalname)}`;
  const fileName = encrypt ? `${baseName}${ENCRYPTED_SUFFIX}` : baseName;
  const filePath = path.join(uploadDir, fileName);
  const data = encrypt ? encryptBuffer(file.buffer) : file.buffer;
  await fs.writeFile(filePath, data, { flag: "wx" });

  return {
    fileName,
    filePath,
    encrypted: encrypt,
    // Public URL only makes sense for unencrypted files.
    url: encrypt ? null : getLocalUploadUrl(fileName),
  };
}

function resolveLocalUpload(fileName) {
  const uploadDir = path.resolve(getUploadDir());
  const filePath = path.resolve(uploadDir, fileName);
  if (!filePath.startsWith(`${uploadDir}${path.sep}`)) {
    throw new Error("Invalid upload file path.");
  }
  return filePath;
}

function isEncryptedUpload(fileName) {
  return String(fileName || "").endsWith(ENCRYPTED_SUFFIX);
}

/**
 * Read a stored upload, transparently decrypting encrypted (restricted) files.
 * @returns {Promise<Buffer>}
 */
async function readLocalUpload(fileName) {
  const filePath = resolveLocalUpload(fileName);
  const stored = await fs.readFile(filePath);
  return isEncryptedUpload(fileName) ? decryptBuffer(stored) : stored;
}

module.exports = {
  saveLocalUpload,
  resolveLocalUpload,
  readLocalUpload,
  isEncryptedUpload,
};
