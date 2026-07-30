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

// Precedence: an explicitly named file wins, then GDRIVE_OAUTH_CLIENT_JSON, then
// server/.env — and only as a last resort a client_secret*.json auto-discovered in
// secrets/. Auto-discovery used to come FIRST, so whichever file happened to be
// newest silently overrode .env. That is how a client which had been DELETED in
// Google Cloud Console got used instead of the live one in .env, producing
// "Error 401: deleted_client" at sign-in. utils/googleDrive.js resolves
// credentials in this same order, so the token minted here now always belongs to
// the client the server actually authenticates with.
const explicitClient = loadOAuthClientFromJson(
  resolveCandidate(process.argv[2]) ||
    resolveCandidate(process.env.GDRIVE_OAUTH_CLIENT_JSON),
);

const envClient =
  process.env.GDRIVE_CLIENT_ID && process.env.GDRIVE_CLIENT_SECRET
    ? {
        clientId: process.env.GDRIVE_CLIENT_ID,
        clientSecret: process.env.GDRIVE_CLIENT_SECRET,
        source: "server/.env (GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET)",
      }
    : null;

const jsonClient =
  explicitClient ||
  envClient ||
  loadOAuthClientFromJson(findNewestOAuthClientJson());

const CLIENT_ID = jsonClient?.clientId;
const CLIENT_SECRET = jsonClient?.clientSecret;

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
    const reason = err?.response?.data?.error || "";
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h1>Failed</h1><pre>${String(err.message || err)}</pre>`);
    console.error("\nFailed to generate refresh token:", err.message || err);
    // Name the client in the failure: these two errors are about the OAuth CLIENT,
    // not the account being signed in, and that distinction is invisible otherwise.
    if (reason === "deleted_client") {
      console.error(
        `\nThe OAuth client ${CLIENT_ID} has been DELETED in Google Cloud Console.\n` +
          "Create a new OAuth client (or use one that still exists), then update\n" +
          "GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET in server/.env.\n",
      );
    } else if (reason === "invalid_client") {
      console.error(
        `\nThe client secret does not match client ${CLIENT_ID}.\n` +
          "Re-copy both values from the same OAuth client in Google Cloud Console.\n",
      );
    }
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log(`\nUsing OAuth client from: ${jsonClient?.source || "server/.env"}`);
  console.log(`Client ID              : ${CLIENT_ID}`);
  console.log(`Redirect URI           : ${REDIRECT_URI}`);
  console.log("   (this exact URI must be listed under Authorized redirect URIs on that client)");
  console.log("\nOpening your browser — sign in with the Google account that OWNS the Drive folders.");
  console.log("If it does not open, copy the FULL URL below (it is one single line):\n");
  console.log(authUrl);
  console.log("\nWaiting for Google OAuth callback on " + REDIRECT_URI + " ...\n");

  // Opening the browser directly avoids the other failure mode seen here: the
  // auth URL wraps across several terminal lines, and pasting a partial copy
  // drops query params — Google then answers "Error 400: invalid_request,
  // Required parameter is missing: response_type".
  const { exec } = require("child_process");
  const command =
    process.platform === "win32"
      ? `start "" "${authUrl}"`
      : process.platform === "darwin"
        ? `open "${authUrl}"`
        : `xdg-open "${authUrl}"`;
  exec(command, (err) => {
    if (err) {
      console.log("(Could not open the browser automatically — paste the full URL above.)\n");
    }
  });
});
