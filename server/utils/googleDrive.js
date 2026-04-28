const { google } = require("googleapis");
const { Readable } = require("stream");

/**
 * Build an authenticated Google Drive client using OAuth2 with a refresh token.
 * Files are owned by the real Google account — no service-account quota issues.
 * Required env vars: GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN
 */
function getDriveClient() {
  const { GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN } = process.env;
  const missing = ["GDRIVE_CLIENT_ID", "GDRIVE_CLIENT_SECRET", "GDRIVE_REFRESH_TOKEN"].filter(
    (k) => !process.env[k] || process.env[k].trim() === ""
  );
  if (missing.length > 0) {
    throw new Error(
      `Google Drive OAuth2 credentials not configured. Missing env vars: ${missing.join(", ")}. ` +
      `Run server/utils/generateDriveToken.js once to obtain a refresh token.`
    );
  }
  const auth = new google.auth.OAuth2(GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GDRIVE_REFRESH_TOKEN });
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
async function uploadFileToDrive(fileBuffer, mimeType, originalName, isImage, overrideFolderId) {
  // Validate folder IDs are still configured in .env
  const missing = ["GDRIVE_IMAGE_FOLDER_ID", "GDRIVE_DOCS_FOLDER_ID"].filter(
    (k) => !process.env[k] || process.env[k].trim() === ""
  );
  if (missing.length > 0 && !overrideFolderId) {
    throw new Error(
      `Google Drive folder IDs not configured. Missing env vars: ${missing.join(", ")}.`
    );
  }

  const drive = getDriveClient();

  const folderId = overrideFolderId
    ? overrideFolderId
    : isImage
    ? process.env.GDRIVE_IMAGE_FOLDER_ID
    : process.env.GDRIVE_DOCS_FOLDER_ID;

  const readable = Readable.from(fileBuffer);

  let response;
  try {
    response = await drive.files.create({
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
  } catch (createErr) {
    throw createErr;
  }

  // Make the file viewable by anyone with the link
  await drive.permissions.create({
    fileId: response.data.id,
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
