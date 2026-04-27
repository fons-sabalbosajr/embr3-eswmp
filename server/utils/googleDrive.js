const { google } = require("googleapis");
const { Readable } = require("stream");
const path = require("path");
const fs = require("fs");

// Path to the service account key file — lives in server/secrets/ (git-ignored)
const KEY_PATH = path.join(__dirname, "..", "secrets", "embr3-eswm-account.json");

/**
 * Build an authenticated Google Drive client using the service account
 * JSON key file at server/secrets/embr3-eswm-account.json.
 */
function getDriveClient() {
  if (!fs.existsSync(KEY_PATH)) {
    throw new Error(
      `Service account key file not found at ${KEY_PATH}. ` +
      `Place embr3-eswm-account.json inside server/secrets/.`
    );
  }
  const key = JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
  return google.drive({ version: "v3", auth });
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
async function uploadFileToDrive(fileBuffer, mimeType, originalName, isImage) {
  // Validate folder IDs are still configured in .env
  const missing = ["GDRIVE_IMAGE_FOLDER_ID", "GDRIVE_DOCS_FOLDER_ID"].filter(
    (k) => !process.env[k] || process.env[k].trim() === ""
  );
  if (missing.length > 0) {
    throw new Error(
      `Google Drive folder IDs not configured. Missing env vars: ${missing.join(", ")}.`
    );
  }

  const drive = getDriveClient();

  const folderId = isImage
    ? process.env.GDRIVE_IMAGE_FOLDER_ID
    : process.env.GDRIVE_DOCS_FOLDER_ID;

  const readable = Readable.from(fileBuffer);

  const response = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: originalName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: readable,
    },
    fields: "id,webViewLink",
  });

  // Make the file viewable by anyone with the link
  await drive.permissions.create({
    fileId: response.data.id,
    supportsAllDrives: true,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });

  return {
    fileId: response.data.id,
    viewUrl: response.data.webViewLink,
  };
}

module.exports = { uploadFileToDrive };
