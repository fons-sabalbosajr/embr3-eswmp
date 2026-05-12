/**
 * Generate a Google Drive OAuth2 refresh token.
 *
 * Run from the server/ directory:
 *   node utils/generateDriveToken.js
 *
 * Required in server/.env:
 *   GDRIVE_CLIENT_ID
 *   GDRIVE_CLIENT_SECRET
 *
 * Google Cloud Console OAuth client setup:
 *   Add http://localhost:3000/oauth2callback as an authorized redirect URI.
 */

require("dotenv").config();

const http = require("http");
const { google } = require("googleapis");

const CLIENT_ID = process.env.GDRIVE_CLIENT_ID;
const CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET;
const PORT = Number(process.env.GDRIVE_TOKEN_PORT || 3000);
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = ["https://www.googleapis.com/auth/drive"];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET must be set in server/.env");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, REDIRECT_URI);
    if (requestUrl.pathname !== "/oauth2callback") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    const code = requestUrl.searchParams.get("code");
    const error = requestUrl.searchParams.get("error");
    if (error) throw new Error(error);
    if (!code) throw new Error("Missing authorization code.");

    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error("Google did not return a refresh token. Revoke app access, then run this script again.");
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h1>Success</h1><p>You can close this tab and return to the terminal.</p>");

    console.log("\nSuccess. Update server/.env with this refresh token:\n");
    console.log(`GDRIVE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("\nRestart the backend after saving .env.\n");
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h1>Failed</h1><pre>${String(err.message || err)}</pre>`);
    console.error("\nFailed to generate refresh token:", err.message || err);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log("\nOpen this URL in your browser and sign in with the Google Drive upload account:\n");
  console.log(authUrl);
  console.log("\nWaiting for Google OAuth callback on " + REDIRECT_URI + " ...\n");
});
