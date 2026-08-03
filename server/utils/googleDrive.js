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

// Classify a Drive failure so callers can tell an AUTHENTICATION problem (the
// stored refresh token is dead → an administrator must re-authorize) apart from a
// FILE/FOLDER PERMISSION problem, a quota problem, or a missing folder. These
// used to be conflated, so the UI showed the same opaque failure for all of them
// and kept retrying a token that could never succeed.
//
// Codes:
//   auth_revoked  — refresh token expired/revoked. NOT recoverable by retrying.
//   auth_failed   — 401 from this credential; another credential may still work.
//   no_permission — authenticated fine, but this account can't touch the folder/file.
//   quota         — rate/storage limit; retrying later may work.
//   not_found     — folder/file id is wrong or deleted.
//   unknown       — anything else.
function classifyDriveError(error) {
  const status = error?.response?.status || error?.code;
  const data = error?.response?.data || {};
  const reason = data.error || error?.errors?.[0]?.reason || "";
  const message = `${error?.message || ""} ${data.error_description || ""}`;
  const haystack = `${reason} ${message}`;

  if (reason === "invalid_grant" || /invalid_grant/i.test(message)) return "auth_revoked";
  if (status === 404) return "not_found";
  // MUST be tested before the generic quota rule below: this string contains the
  // word "quota" but is a PERMANENT configuration limit (a service account has no
  // My Drive storage of its own), not a transient rate limit. Retrying never helps.
  if (/Service Accounts do not have storage quota/i.test(haystack)) return "service_account_no_quota";
  if (status === 429 || /rateLimit|userRateLimitExceeded|storageQuotaExceeded|quotaExceeded/i.test(haystack)) {
    return "quota";
  }
  if (status === 403) return "no_permission";
  if (status === 401) return "auth_failed";
  return "unknown";
}

const DRIVE_ERROR_HINTS = {
  auth_revoked:
    "Google Drive authorization has expired or been revoked. An administrator must re-authorize the Drive connection (regenerate GDRIVE_REFRESH_TOKEN). Note: if the Google Cloud OAuth consent screen is still in \"Testing\" status, refresh tokens expire every 7 days — publish the app to \"In production\" to stop this recurring.",
  auth_failed: "Google rejected the stored Drive credentials.",
  no_permission:
    "Authenticated with Google, but this account has no permission on the target Drive folder/file. Share the folder with the authorized account (Editor).",
  quota: "Google Drive quota or rate limit reached. Try again later.",
  service_account_no_quota:
    "The service-account fallback cannot upload: service accounts have no Drive storage of their own. It can only write into a Shared Drive. Restore the OAuth refresh token, or move the target folders into a Shared Drive and grant the service account access.",
  not_found: "The configured Google Drive folder/file was not found. Check the GDRIVE_*_FOLDER_ID values.",
  unknown: "Google Drive request failed.",
};

// Attach the classification to the error so routes can return a meaningful,
// actionable response instead of a generic 500 — and so the client knows whether
// retrying is even sensible.
function decorateDriveError(error) {
  const code = classifyDriveError(error);
  error.driveErrorCode = code;
  error.requiresReauth = code === "auth_revoked";
  // Never retryable: a revoked refresh token stays revoked.
  error.retryable = code === "quota";
  error.hint = DRIVE_ERROR_HINTS[code];
  return error;
}

// Should we try the NEXT configured credential (e.g. the service-account
// fallback)? Only for credential-level failures — a 403 folder-permission error
// or a 404 is not going to be fixed by swapping credentials in the general case,
// but a dead/rejected OAuth token genuinely might be.
function shouldTryNextClient(error) {
  const code = classifyDriveError(error);
  return code === "auth_revoked" || code === "auth_failed" || code === "no_permission";
}

// Back-compat name used by streamDriveFile below.
function isRetryableAuthError(error) {
  return shouldTryNextClient(error);
}

async function createDriveFile(drive, mediaBody, mimeType, originalName, folderId, makePublic = true) {
  const response = await drive.files.create({
    requestBody: {
      name: originalName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: mediaBody,
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
  return uploadMediaToDrive(() => Readable.from(fileBuffer), mimeType, originalName, isImage, overrideFolderId, makePublic);
}

async function uploadFilePathToDrive(filePath, mimeType, originalName, isImage, overrideFolderId, makePublic = true) {
  return uploadMediaToDrive(() => fs.createReadStream(filePath), mimeType, originalName, isImage, overrideFolderId, makePublic);
}

async function uploadMediaToDrive(createMediaBody, mimeType, originalName, isImage, overrideFolderId, makePublic = true) {
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
  let revokedError = null; // the PRIMARY cause, if a credential was revoked
  const attempts = [];
  for (let index = 0; index < clients.length; index += 1) {
    const client = clients[index];
    try {
      return await createDriveFile(client.drive, createMediaBody(), mimeType, originalName, folderId, makePublic);
    } catch (error) {
      lastError = decorateDriveError(error);
      if (error.driveErrorCode === "auth_revoked" && !revokedError) revokedError = error;
      attempts.push(`${client.name}: ${error.message || error}`);
      const hasFallback = index < clients.length - 1;
      // Only fall through to another CREDENTIAL for credential-level failures.
      // A 404 folder or a quota error will fail identically on every client.
      if (!hasFallback || !shouldTryNextClient(error)) break;
    }
  }

  // Report the ROOT cause, not merely the last symptom. When the OAuth token is
  // revoked, the service-account fallback then fails with its own unrelated
  // complaint ("Service Accounts do not have storage quota") — surfacing that
  // would send an operator chasing the wrong problem. A revoked credential is
  // what actually has to be fixed, so it wins.
  const primary = revokedError || lastError;
  if (primary) {
    const detail =
      attempts.length > 1
        ? `Google Drive upload failed after ${attempts.length} attempts. ${attempts.join(" | ")}`
        : primary.message;
    primary.message = primary.hint ? `${primary.hint} (${detail})` : detail;
  }
  throw primary;
}

async function verifyDriveAccess() {
  // Only the image + document folders are required for uploads. The hauler-LOI
  // folder is optional — verify it only when configured so the test connection
  // reflects actual upload capability (previously it hard-failed when hauler-LOI
  // was unset, even though normal uploads still worked).
  const allTargets = [
    { key: "images", id: process.env.GDRIVE_IMAGE_FOLDER_ID, required: true },
    { key: "documents", id: process.env.GDRIVE_DOCS_FOLDER_ID, required: true },
    { key: "haulerLoi", id: process.env.GDRIVE_HAULER_LOI_FOLDER_ID, required: false },
  ];
  const missing = allTargets.filter((item) => item.required && !hasValue(item.id)).map((item) => item.key);
  if (missing.length > 0) {
    throw new Error(`Google Drive folder IDs not configured for: ${missing.join(", ")}.`);
  }
  const folderTargets = allTargets.filter((item) => hasValue(item.id));

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
          // `driveId` is only present for items that live on a Shared Drive — the
          // one place a service account is able to upload. See the upload-capability
          // gate below.
          fields: "id,name,mimeType,driveId,capabilities(canAddChildren)",
          supportsAllDrives: true,
        });
        folders.push({
          key: target.key,
          id: response.data.id,
          name: response.data.name,
          mimeType: response.data.mimeType,
          sharedDrive: Boolean(response.data.driveId),
          writable: response.data.capabilities?.canAddChildren !== false,
        });
      }

      // READING folder metadata is not proof that UPLOADS work, and conflating the
      // two is how a dead OAuth refresh token stayed invisible: the service-account
      // fallback can list these folders, so this check reported "Connected" while
      // every admin upload failed over to local disk. A service account has no
      // Drive storage of its own, so unless the target folders are on a Shared
      // Drive it can never create a file there — report that as a failure.
      const cannotUpload =
        client.name === "service account" &&
        folders.some((folder) => folder.key !== "haulerLoi" && !folder.sharedDrive);
      if (cannotUpload) {
        const reauthNeeded = attempts.length > 0;
        const error = new Error(
          "Google Drive can be read but NOT written to: only the service-account " +
            "fallback could authenticate, and service accounts have no Drive storage " +
            "of their own (the target folders are not on a Shared Drive), so every " +
            "upload will fail. " +
            (reauthNeeded ? DRIVE_ERROR_HINTS.auth_revoked : DRIVE_ERROR_HINTS.service_account_no_quota) +
            (attempts.length ? ` (${attempts.join(" | ")})` : "")
        );
        error.driveErrorCode = reauthNeeded ? "auth_revoked" : "service_account_no_quota";
        error.requiresReauth = reauthNeeded;
        error.retryable = false;
        error.hint = DRIVE_ERROR_HINTS[error.driveErrorCode];
        throw error;
      }

      return {
        ok: true,
        client: client.name,
        folders,
      };
    } catch (error) {
      // The upload-capability gate above is already fully explained and is not a
      // credential failure another client could recover from — surface it as-is.
      if (error.driveErrorCode === "auth_revoked" || error.driveErrorCode === "service_account_no_quota") {
        throw error;
      }
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
  // Only image + document folders are required for uploads; hauler-LOI is
  // optional (kept in `folders` for visibility but never blocks `ok`).
  const REQUIRED_FOLDER_KEYS = ["GDRIVE_IMAGE_FOLDER_ID", "GDRIVE_DOCS_FOLDER_ID"];

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
  for (const key of REQUIRED_FOLDER_KEYS) {
    if (!folders[key]) missing.push(key);
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
      lastError = decorateDriveError(error);
      const code = error.driveErrorCode;
      if (code === "not_found") {
        return {
          accessible: false,
          reason: "not_found",
          message: "File not found in Google Drive.",
          fileId,
          meta: null,
        };
      }
      if (code === "no_permission") {
        return {
          accessible: false,
          reason: "no_permission",
          message:
            "The file exists but the current Google account has no permission to access it.",
          fileId,
          meta: null,
        };
      }
      if (code === "quota") {
        return { accessible: false, reason: "quota", message: DRIVE_ERROR_HINTS.quota, fileId, meta: null };
      }
      // Credential failure — try the next client (service-account fallback).
    }
  }

  // Every configured credential failed to authenticate. Report this as an AUTH
  // problem needing re-authorization, NOT as "the file link is invalid" — the
  // file is very likely fine; it is our token that is dead.
  const revoked = lastError?.driveErrorCode === "auth_revoked";
  return {
    accessible: false,
    reason: revoked ? "auth_revoked" : "auth_error",
    requiresReauth: !!revoked,
    message: revoked
      ? DRIVE_ERROR_HINTS.auth_revoked
      : `Could not authenticate with Google Drive. ${lastError?.message || ""}`.trim(),
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
  classifyDriveError,
  decorateDriveError,
  DRIVE_ERROR_HINTS,
};
