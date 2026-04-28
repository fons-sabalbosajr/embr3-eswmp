/**
 * ONE-TIME SCRIPT — Generate a Google Drive OAuth2 refresh token.
 *
 * Run ONCE from the server/ directory:
 *   node utils/generateDriveToken.js
 *
 * Prerequisites (fill in below before running):
 *   GDRIVE_CLIENT_ID     — from Google Cloud Console → OAuth 2.0 Client IDs
 *   GDRIVE_CLIENT_SECRET — same place
 *
 * What it does:
 *   1. Prints an authorization URL — open it in a browser and sign in with
 *      the Google account whose Drive you want to upload to.
 *   2. Google redirects to localhost with a ?code= param — paste that code here.
 *   3. Prints the refresh token — copy it into .env as GDRIVE_REFRESH_TOKEN.
 */

const { google } = require("googleapis");
const readline = require("readline");

// ── Set these in server/.env before running ───────────────────────────────────
// GDRIVE_CLIENT_ID=<your-client-id>
// GDRIVE_CLIENT_SECRET=<your-client-secret>
const CLIENT_ID     = process.env.GDRIVE_CLIENT_ID;
const CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌  GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET must be set in server/.env");
  process.exit(1);
}
// ──────────────────────────────────────────────────────────────────────────────

const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob"; // out-of-band — no local server needed
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",           // always get a refresh token
  scope: SCOPES,
});

console.log("\n──────────────────────────────────────────────────────────────");
console.log("Step 1: Open this URL in a browser and sign in with the Google");
console.log("        account whose Drive you want to use for file uploads:");
console.log("\n" + authUrl + "\n");
console.log("Step 2: After signing in, Google will show you an auth code.");
console.log("        Copy it and paste it below.");
console.log("──────────────────────────────────────────────────────────────\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question("Paste the authorization code here: ", async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    console.log("\n✅  Success! Add these to your server/.env:\n");
    console.log(`GDRIVE_CLIENT_ID=${CLIENT_ID}`);
    console.log(`GDRIVE_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`GDRIVE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("\nThe refresh token does not expire unless you revoke access.");
    console.log("Keep it secret — treat it like a password.\n");
  } catch (err) {
    console.error("\n❌  Failed to exchange code for token:", err.message);
    console.error("Make sure you pasted the full code and that CLIENT_ID/SECRET are correct.\n");
  }
});
