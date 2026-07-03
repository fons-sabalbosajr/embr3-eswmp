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

async function createDriveFile(drive, fileBuffer, mimeType, originalName, folderId, makePublic = true) {
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

  // Restricted (admin-side) media skips the public "anyone" permission so the
  // file is only reachable through the authenticated /media proxy.
  if (makePublic) {
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
      supportsAllDrives: true,
    });
  }

  return {
    fileId: response.data.id,
    viewUrl: response.data.webViewLink,
  };
}

/**
 * Stream a Drive file's bytes through the first working authenticated client.
 * Used by the restricted media proxy so files that are NOT publicly shared can
 * still be viewed by authorized admin/developer users.
 *
 * @param {string} fileId
 * @param {import('http').ServerResponse} res - response to pipe into
 */
async function streamDriveFile(fileId, res) {
  const clients = getDriveClients();
  let lastError;
  for (const client of clients) {
    try {
      const meta = await client.drive.files.get({
        fileId,
        fields: "mimeType,name,size",
        supportsAllDrives: true,
      });
      if (meta.data.mimeType) res.setHeader("Content-Type", meta.data.mimeType);
      if (meta.data.size) res.setHeader("Content-Length", meta.data.size);
      const streamResp = await client.drive.files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "stream" }
      );
      await new Promise((resolve, reject) => {
        streamResp.data.on("end", resolve).on("error", reject).pipe(res);
      });
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableAuthError(error)) throw error;
    }
  }
  throw lastError || new Error("Unable to stream Drive file.");
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
async function uploadFileToDrive(fileBuffer, mimeType, originalName, isImage, overrideFolderId, makePublic = true) {
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
      return await createDriveFile(client.drive, fileBuffer, mimeType, originalName, folderId, makePublic);
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

/**
 * Inspect the current Google Drive configuration without making any network
 * calls. Used for startup validation and the admin Drive status endpoint so a
 * readable error can be surfaced when required env vars are missing.
 *
 * @returns {{ ok: boolean, authMethod: string, missing: string[],
 *             folders: Record<string, boolean>, hasServiceAccountFallback: boolean }}
 */
function getDriveConfigStatus() {
  const jsonClient = loadOAuthClientJson();
  const hasOAuthClient =
    Boolean(jsonClient) ||
    (hasValue(process.env.GDRIVE_CLIENT_ID) &&
      hasValue(process.env.GDRIVE_CLIENT_SECRET));
  const hasRefreshToken = hasValue(process.env.GDRIVE_REFRESH_TOKEN);
  const hasServiceAccountFallback = Boolean(getServiceAccountKeyFile());

  const folders = {
    GDRIVE_IMAGE_FOLDER_ID: hasValue(process.env.GDRIVE_IMAGE_FOLDER_ID),
    GDRIVE_DOCS_FOLDER_ID: hasValue(process.env.GDRIVE_DOCS_FOLDER_ID),
    GDRIVE_HAULER_LOI_FOLDER_ID: hasValue(process.env.GDRIVE_HAULER_LOI_FOLDER_ID),
  };

  const missing = [];
  // A usable auth method requires either full OAuth (client + refresh token) or
  // a service account key file.
  const oauthUsable = hasOAuthClient && hasRefreshToken;
  if (!oauthUsable && !hasServiceAccountFallback) {
    if (!hasOAuthClient) {
      missing.push("GDRIVE_CLIENT_ID/GDRIVE_CLIENT_SECRET (or GDRIVE_OAUTH_CLIENT_JSON)");
    }
    if (!hasRefreshToken) {
      missing.push("GDRIVE_REFRESH_TOKEN");
    }
  }
  for (const [key, present] of Object.entries(folders)) {
    if (!present) missing.push(key);
  }

  let authMethod = "none";
  if (oauthUsable) authMethod = "oauth";
  else if (hasServiceAccountFallback) authMethod = "service-account";

  return {
    ok: missing.length === 0,
    authMethod,
    hasServiceAccountFallback,
    folders,
    missing,
  };
}

/**
 * Extract a Google Drive file ID from any of the common URL shapes Drive
 * produces (webViewLink, /file/d/<id>/view, ?id=<id>, uc?export=view&id=<id>).
 * Returns null when the value is not a Drive URL/ID.
 */
function extractDriveFileId(value) {
  if (!hasValue(value)) return null;
  const str = String(value).trim();
  // Already a bare ID (Drive IDs are 20+ url-safe chars, no slashes/spaces)
  if (/^[a-zA-Z0-9_-]{20,}$/.test(str)) return str;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /\/folders\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/d\/([a-zA-Z0-9_-]+)/,
  ];
  for (const rx of patterns) {
    const match = str.match(rx);
    if (match && match[1]) return match[1];
  }
  return null;
}

/**
 * Validate whether a Drive-hosted file is currently accessible and return
 * human-readable status information. Never throws — always resolves to a status
 * object so callers can surface a clear prompt instead of crashing.
 *
 * @param {string} urlOrId - A Drive URL or file ID.
 * @returns {Promise<{ accessible: boolean, reason: string, message: string,
 *   fileId: string|null, meta: object|null }>}
 */
async function validateDriveFile(urlOrId) {
  const fileId = extractDriveFileId(urlOrId);
  if (!fileId) {
    // Not a Drive URL (e.g. locally-stored fallback file) — treat as non-Drive.
    return {
      accessible: !!urlOrId,
      reason: hasValue(urlOrId) ? "non_drive" : "missing",
      message: hasValue(urlOrId)
        ? "File is stored outside Google Drive."
        : "The SLF record exists, but no file is attached.",
      fileId: null,
      meta: null,
    };
  }

  let clients;
  try {
    clients = getDriveClients();
  } catch (error) {
    return {
      accessible: false,
      reason: "not_configured",
      message: `Google Drive is not configured: ${error.message}`,
      fileId,
      meta: null,
    };
  }

  let lastError;
  for (const client of clients) {
    try {
      const response = await client.drive.files.get({
        fileId,
        fields: "id,name,mimeType,size,modifiedTime,trashed,webViewLink,capabilities(canDownload)",
        supportsAllDrives: true,
      });
      const data = response.data || {};
      if (data.trashed) {
        return {
          accessible: false,
          reason: "trashed",
          message: "The file link is invalid or expired (file is in Trash).",
          fileId,
          meta: data,
        };
      }
      return {
        accessible: true,
        reason: "ok",
        message: "File is accessible.",
        fileId,
        meta: {
          id: data.id,
          name: data.name,
          mimeType: data.mimeType,
          size: data.size ? Number(data.size) : null,
          modifiedTime: data.modifiedTime,
          webViewLink: data.webViewLink,
        },
      };
    } catch (error) {
      lastError = error;
      const status = error?.response?.status || error?.code;
      if (status === 404) {
        return {
          accessible: false,
          reason: "not_found",
          message: "File not found in Google Drive.",
          fileId,
          meta: null,
        };
      }
      if (status === 403) {
        return {
          accessible: false,
          reason: "no_permission",
          message:
            "The file exists but the current Google account has no permission to access it.",
          fileId,
          meta: null,
        };
      }
      // 401/invalid_grant — try the next client (service account fallback)
    }
  }

  return {
    accessible: false,
    reason: "auth_error",
    message: `The file link is invalid or expired. ${lastError?.message || ""}`.trim(),
    fileId,
    meta: null,
  };
}

module.exports = {
  uploadFileToDrive,
  streamDriveFile,
  verifyDriveAccess,
  getDriveConfigStatus,
  extractDriveFileId,
  validateDriveFile,
  getDriveClients,
};
