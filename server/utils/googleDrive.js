const { google } = require("googleapis");
const { Readable } = require("stream");
const fs = require("fs");
const path = require("path");

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "";
}

function resolveKeyFile(candidate) {
  if (!hasValue(candidate)) return null;
  const resolved = path.isAbsolute(candidate)
    ? candidate
    : path.resolve(process.cwd(), candidate);
  return fs.existsSync(resolved) ? resolved : null;
}

function loadOAuthClientJson() {
  const filePath = resolveKeyFile(process.env.GDRIVE_OAUTH_CLIENT_JSON);
  if (!filePath) return null;
  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const config = json.web || json.installed;
  if (!config?.client_id || !config?.client_secret) return null;
  return {
    clientId: config.client_id,
    clientSecret: config.client_secret,
  };
}

function getServiceAccountKeyFile() {
  return (
    resolveKeyFile(process.env.GDRIVE_SERVICE_ACCOUNT_KEY_FILE) ||
    resolveKeyFile(process.env.GOOGLE_APPLICATION_CREDENTIALS) ||
    resolveKeyFile(path.join(__dirname, "..", "secrets", "embr3-eswm-account.json"))
  );
}

/**
 * Build authenticated Google Drive clients. OAuth is tried first so files stay
 * owned by the configured Google account, then a service account is used as a
 * fallback when the refresh token is revoked or expired.
 */
function getOAuthDriveClient() {
  const jsonClient = loadOAuthClientJson();
  const clientId = jsonClient?.clientId || process.env.GDRIVE_CLIENT_ID;
  const clientSecret = jsonClient?.clientSecret || process.env.GDRIVE_CLIENT_SECRET;
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: process.env.GDRIVE_REFRESH_TOKEN });
  return google.drive({ version: "v3", auth });
}

function getServiceAccountDriveClient(keyFile) {
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: DRIVE_SCOPES,
  });
  return google.drive({ version: "v3", auth });
}

function getDriveClients() {
  const clients = [];
  const jsonClient = loadOAuthClientJson();
  const hasOAuthClient =
    jsonClient ||
    (hasValue(process.env.GDRIVE_CLIENT_ID) &&
      hasValue(process.env.GDRIVE_CLIENT_SECRET));
  const oauthMissing = [
    !hasOAuthClient ? "GDRIVE_CLIENT_ID/GDRIVE_CLIENT_SECRET or GDRIVE_OAUTH_CLIENT_JSON" : null,
    !hasValue(process.env.GDRIVE_REFRESH_TOKEN) ? "GDRIVE_REFRESH_TOKEN" : null,
  ].filter(Boolean);

  if (oauthMissing.length === 0) {
    clients.push({ name: "OAuth2 refresh token", drive: getOAuthDriveClient() });
  }

  const serviceAccountKeyFile = getServiceAccountKeyFile();
  if (serviceAccountKeyFile) {
    clients.push({ name: "service account", drive: getServiceAccountDriveClient(serviceAccountKeyFile) });
  }

  if (clients.length === 0) {
    const missing = oauthMissing.length
      ? ` Missing OAuth env vars: ${oauthMissing.join(", ")}.`
      : "";
    throw new Error(
      `Google Drive credentials not configured.${missing} ` +
      `Set GDRIVE_REFRESH_TOKEN or configure GDRIVE_SERVICE_ACCOUNT_KEY_FILE.`
    );
  }

  return clients;
}

function isRetryableAuthError(error) {
  const status = error?.response?.status || error?.code;
  const reason = error?.response?.data?.error || error?.errors?.[0]?.reason || "";
  const message = error?.message || "";
  return (
    status === 401 ||
    status === 403 ||
    reason === "invalid_grant" ||
    message.includes("invalid_grant")
  );
}

async function createDriveFile(drive, fileBuffer, mimeType, originalName, folderId) {
  const response = await drive.files.create({
    requestBody: {
      name: originalName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(fileBuffer),
    },
    fields: "id,webViewLink",
    supportsAllDrives: true,
  });

  await drive.permissions.create({
    fileId: response.data.id,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
    supportsAllDrives: true,
  });

  return {
    fileId: response.data.id,
    viewUrl: response.data.webViewLink,
  };
}

/**
 * Upload a file buffer to Google Drive.
 *
 * @param {Buffer} fileBuffer   - File contents
 * @param {string} mimeType     - MIME type of the file
 * @param {string} originalName - Original filename (used as Drive name)
 * @param {boolean} isImage     - true → images folder, false → documents folder
 * @returns {{ fileId: string, viewUrl: string }}
 */
async function uploadFileToDrive(fileBuffer, mimeType, originalName, isImage, overrideFolderId) {
  // Validate folder IDs are still configured in .env
  const missing = ["GDRIVE_IMAGE_FOLDER_ID", "GDRIVE_DOCS_FOLDER_ID"].filter(
    (k) => !hasValue(process.env[k])
  );
  if (missing.length > 0 && !overrideFolderId) {
    throw new Error(
      `Google Drive folder IDs not configured. Missing env vars: ${missing.join(", ")}.`
    );
  }

  const clients = getDriveClients();

  const folderId = overrideFolderId
    ? overrideFolderId
    : isImage
    ? process.env.GDRIVE_IMAGE_FOLDER_ID
    : process.env.GDRIVE_DOCS_FOLDER_ID;

  let lastError;
  const attempts = [];
  for (let index = 0; index < clients.length; index += 1) {
    const client = clients[index];
    try {
      return await createDriveFile(client.drive, fileBuffer, mimeType, originalName, folderId);
    } catch (error) {
      lastError = error;
      attempts.push(`${client.name}: ${error.message || error}`);
      const hasFallback = index < clients.length - 1;
      if (!hasFallback || !isRetryableAuthError(error)) {
        if (attempts.length > 1) {
          error.message = `Google Drive upload failed after ${attempts.length} attempts. ${attempts.join(" | ")}`;
        }
        throw error;
      }
      // Auth error on this client — try next client silently; caller handles Drive failure logging
    }
  }

  if (lastError && attempts.length > 1) {
    lastError.message = `Google Drive upload failed after ${attempts.length} attempts. ${attempts.join(" | ")}`;
  }
  throw lastError;
}

async function verifyDriveAccess() {
  const folderTargets = [
    { key: "images", id: process.env.GDRIVE_IMAGE_FOLDER_ID },
    { key: "documents", id: process.env.GDRIVE_DOCS_FOLDER_ID },
    { key: "haulerLoi", id: process.env.GDRIVE_HAULER_LOI_FOLDER_ID },
  ];
  const missing = folderTargets.filter((item) => !hasValue(item.id)).map((item) => item.key);
  if (missing.length > 0) {
    throw new Error(`Google Drive folder IDs not configured for: ${missing.join(", ")}.`);
  }

  const clients = getDriveClients();
  const attempts = [];
  let lastError;

  for (let index = 0; index < clients.length; index += 1) {
    const client = clients[index];
    try {
      const folders = [];
      for (const target of folderTargets) {
        const response = await client.drive.files.get({
          fileId: target.id,
          fields: "id,name,mimeType,capabilities(canAddChildren)",
          supportsAllDrives: true,
        });
        folders.push({
          key: target.key,
          id: response.data.id,
          name: response.data.name,
          mimeType: response.data.mimeType,
          writable: response.data.capabilities?.canAddChildren !== false,
        });
      }
      return {
        ok: true,
        client: client.name,
        folders,
      };
    } catch (error) {
      lastError = error;
      attempts.push(`${client.name}: ${error.message || error}`);
      const hasFallback = index < clients.length - 1;
      if (!hasFallback || !isRetryableAuthError(error)) {
        if (attempts.length > 1) {
          error.message = `Google Drive verification failed after ${attempts.length} attempts. ${attempts.join(" | ")}`;
        }
        throw error;
      }
    }
  }

  if (lastError && attempts.length > 1) {
    lastError.message = `Google Drive verification failed after ${attempts.length} attempts. ${attempts.join(" | ")}`;
  }
  throw lastError;
}

module.exports = { uploadFileToDrive, verifyDriveAccess };
