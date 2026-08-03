const crypto = require("crypto");
const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const { pipeline } = require("stream/promises");
const { ENCRYPTED_SUFFIX, getEncryptionKey, encryptBuffer, decryptBuffer } = require("./mediaSecurity");

const ENC_ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

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
  if (file.path) {
    if (encrypt) {
      const iv = crypto.randomBytes(IV_LEN);
      const cipher = crypto.createCipheriv(ENC_ALGO, getEncryptionKey(), iv);
      const handle = await fs.open(filePath, "wx");
      try {
        await handle.write(iv, 0, IV_LEN, 0);
        await handle.write(Buffer.alloc(TAG_LEN), 0, TAG_LEN, IV_LEN);
        const out = fsSync.createWriteStream(filePath, {
          fd: handle.fd,
          start: IV_LEN + TAG_LEN,
          autoClose: false,
        });
        await pipeline(fsSync.createReadStream(file.path), cipher, out);
        await handle.write(cipher.getAuthTag(), 0, TAG_LEN, IV_LEN);
      } catch (error) {
        await fs.unlink(filePath).catch(() => {});
        throw error;
      } finally {
        await handle.close().catch(() => {});
      }
    } else {
      await pipeline(fsSync.createReadStream(file.path), fsSync.createWriteStream(filePath, { flags: "wx" }));
    }
  } else {
    const data = encrypt ? encryptBuffer(file.buffer) : file.buffer;
    await fs.writeFile(filePath, data, { flag: "wx" });
  }

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
