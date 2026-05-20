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
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const PORT = Number(process.env.GDRIVE_TOKEN_PORT || 3000);
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = ["https://www.googleapis.com/auth/drive"];

function resolveCandidate(candidate) {
  if (!candidate) return null;
  return path.isAbsolute(candidate)
    ? candidate
    : path.resolve(process.cwd(), candidate);
}

function findNewestOAuthClientJson() {
  const secretsDir = path.resolve(process.cwd(), "secrets");
  if (!fs.existsSync(secretsDir)) return null;

  const files = fs
    .readdirSync(secretsDir)
    .filter((fileName) => /^client[-_]secret.*[.]json$/i.test(fileName))
    .map((fileName) => {
      const filePath = path.join(secretsDir, fileName);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return files[0]?.filePath || null;
}

function loadOAuthClientFromJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const config = json.web || json.installed;
  if (!config?.client_id || !config?.client_secret) return null;
  return {
    clientId: config.client_id,
    clientSecret: config.client_secret,
    source: filePath,
  };
}

const jsonPath =
  resolveCandidate(process.argv[2]) ||
  resolveCandidate(process.env.GDRIVE_OAUTH_CLIENT_JSON) ||
  findNewestOAuthClientJson();

const jsonClient = loadOAuthClientFromJson(jsonPath);
const CLIENT_ID = jsonClient?.clientId || process.env.GDRIVE_CLIENT_ID;
const CLIENT_SECRET = jsonClient?.clientSecret || process.env.GDRIVE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Google OAuth client credentials were not found. Set GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET in server/.env, or pass a client_secret JSON path.",
  );
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
  if (jsonClient?.source) {
    console.log(`\nUsing OAuth client JSON: ${jsonClient.source}`);
  } else {
    console.log("\nUsing OAuth client credentials from server/.env");
  }
  console.log("\nOpen this URL in your browser and sign in with the Google Drive upload account:\n");
  console.log(authUrl);
  console.log("\nWaiting for Google OAuth callback on " + REDIRECT_URI + " ...\n");
});
