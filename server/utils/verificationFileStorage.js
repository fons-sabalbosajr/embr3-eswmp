const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const DEFAULT_UPLOAD_DIR = path.join(__dirname, "..", "uploads", "verification");

function getUploadDir() {
  const configuredDir = process.env.VERIFICATION_UPLOAD_DIR;
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

function getVerificationFileUrl(fileName) {
  return `${getPublicApiBasePath()}/portal-auth/verification-files/${encodeURIComponent(fileName)}`;
}

async function saveVerificationFile(file) {
  const uploadDir = getUploadDir();
  await fs.mkdir(uploadDir, { recursive: true });

  const fileName = `${Date.now()}-${crypto.randomBytes(16).toString("hex")}${getSafeExtension(file.originalname)}`;
  const filePath = path.join(uploadDir, fileName);
  await fs.writeFile(filePath, file.buffer, { flag: "wx" });

  return {
    fileName,
    filePath,
    url: getVerificationFileUrl(fileName),
  };
}

function resolveVerificationFile(fileName) {
  const uploadDir = path.resolve(getUploadDir());
  const filePath = path.resolve(uploadDir, fileName);
  if (!filePath.startsWith(`${uploadDir}${path.sep}`)) {
    throw new Error("Invalid verification file path.");
  }
  return filePath;
}

module.exports = {
  saveVerificationFile,
  resolveVerificationFile,
};