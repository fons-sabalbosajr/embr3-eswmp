/**
 * Generate a Gmail OAuth2 refresh token for use as GMAIL_REFRESH_TOKEN.
 *
 * Run from the server/ directory:
 *   node utils/generateGmailToken.js
 *
 * Required in server/.env (same OAuth2 client used for Google Drive):
 *   GDRIVE_CLIENT_ID
 *   GDRIVE_CLIENT_SECRET
 *
 * When the browser opens, sign in with the Gmail account set in EMAIL_USER,
 * then grant the "Send email on your behalf" permission.
 *
 * The refresh token is written to server/.env as GMAIL_REFRESH_TOKEN.
 */

require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const PORT = Number(process.env.GDRIVE_TOKEN_PORT || 3001);
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

// Gmail send scope — separate from Drive scope
const GMAIL_SCOPES = ["https://mail.google.com/"];

// ── Resolve OAuth2 client credentials ──
function findNewestOAuthClientJson() {
  const secretsDir = path.resolve(process.cwd(), "secrets");
  if (!fs.existsSync(secretsDir)) return null;
  return (
    fs
      .readdirSync(secretsDir)
      .filter((f) => /^client[-_]secret.*\.json$/i.test(f))
      .map((f) => ({ f, m: fs.statSync(path.join(secretsDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)[0]?.f
      ? path.join(
          secretsDir,
          fs
            .readdirSync(secretsDir)
            .filter((f) => /^client[-_]secret.*\.json$/i.test(f))
            .sort(
              (a, b) =>
                fs.statSync(path.join(secretsDir, b)).mtimeMs -
                fs.statSync(path.join(secretsDir, a)).mtimeMs,
            )[0],
        )
      : null
  );
}

function loadFromJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const cfg = j.web || j.installed;
    return cfg?.client_id && cfg?.client_secret
      ? { clientId: cfg.client_id, clientSecret: cfg.client_secret }
      : null;
  } catch {
    return null;
  }
}

// Same precedence as utils/generateDriveToken.js: an explicitly named file, then
// .env, and only then a secrets/client_secret*.json auto-discovered by mtime.
// Auto-discovery must NOT come first — picking whichever file is newest silently
// overrode .env and could hand back a client that no longer exists in Google
// Cloud Console ("Error 401: deleted_client").
const fromJson =
  loadFromJson(process.argv[2] || process.env.GDRIVE_OAUTH_CLIENT_JSON) ||
  (process.env.GDRIVE_CLIENT_ID && process.env.GDRIVE_CLIENT_SECRET
    ? {
        clientId: process.env.GDRIVE_CLIENT_ID,
        clientSecret: process.env.GDRIVE_CLIENT_SECRET,
      }
    : null) ||
  loadFromJson(findNewestOAuthClientJson());

const CLIENT_ID = fromJson?.clientId;
const CLIENT_SECRET = fromJson?.clientSecret;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "\n❌  OAuth2 client credentials not found.\n" +
      "    Set GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET in server/.env,\n" +
      "    or pass the path to a client_secret JSON file as the first argument.\n",
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // forces a new refresh token even if previously authorized
  scope: GMAIL_SCOPES,
});

// ── Write / update GMAIL_REFRESH_TOKEN in .env ──
function patchEnvFile(key, value) {
  const envPath = path.resolve(process.cwd(), ".env");
  let contents = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const regex = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  if (regex.test(contents)) {
    contents = contents.replace(regex, line);
  } else {
    contents = contents.trimEnd() + `\n${line}\n`;
  }
  fs.writeFileSync(envPath, contents, "utf8");
}

// ── Start a one-shot HTTP server to receive the OAuth callback ──
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end("<h2>Error: no code in callback</h2>");
    server.close();
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(
        "<h2>No refresh token received.</h2>" +
          "<p>Go to <a href='https://myaccount.google.com/permissions'>Google Account Permissions</a>, " +
          "revoke this app's access, then run the script again.</p>",
      );
      server.close();
      return;
    }

    patchEnvFile("GMAIL_REFRESH_TOKEN", tokens.refresh_token);

    console.log("\n✅  Gmail refresh token saved to server/.env as GMAIL_REFRESH_TOKEN");
    console.log("    Restart the server — it will now use OAuth2 for email (no App Password needed).\n");

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<h2 style='font-family:sans-serif;color:green'>✅ Gmail OAuth2 token saved!</h2>" +
        "<p style='font-family:sans-serif'>You can close this tab and restart the server.</p>",
    );
  } catch (err) {
    console.error("\n❌  Token exchange failed:", err.message);
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h2>Token exchange failed: ${err.message}</h2>`);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log(
    `\n🔑  Gmail OAuth2 Token Generator\n` +
      `    Email account : ${process.env.EMAIL_USER || "(not set — set EMAIL_USER in .env)"}\n` +
      `    Scope         : ${GMAIL_SCOPES.join(", ")}\n\n` +
      `    Opening browser — sign in as the Gmail account that will SEND emails,\n` +
      `    then grant the requested permission.\n\n` +
      `    Authorization URL:\n    ${authUrl}\n`,
  );

  // Try to open browser automatically
  const { exec } = require("child_process");
  const cmd =
    process.platform === "win32"
      ? `start "" "${authUrl}"`
      : process.platform === "darwin"
        ? `open "${authUrl}"`
        : `xdg-open "${authUrl}"`;
  exec(cmd, (err) => {
    if (err) {
      console.log("    (Could not open browser automatically — paste the URL above manually)\n");
    }
  });
});
