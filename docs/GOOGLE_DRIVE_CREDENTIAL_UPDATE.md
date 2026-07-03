# Google Drive Credential Update Guide

This guide is for updating the backend to use a **new Google account** for Google Drive uploads in the SLF Admin application.

## Purpose

Use this whenever you need to replace the current Google Drive OAuth credentials and folder IDs in:

- `server/.env`

This app uses these backend environment variables for Google Drive:

- `GDRIVE_CLIENT_ID`
- `GDRIVE_CLIENT_SECRET`
- `GDRIVE_REFRESH_TOKEN`
- `GDRIVE_IMAGE_FOLDER_ID`
- `GDRIVE_DOCS_FOLDER_ID`
- `GDRIVE_HAULER_LOI_FOLDER_ID`

## Where the app loads these values

The current implementation loads Google Drive config from backend environment variables in:

- `server/utils/googleDrive.js`

Related backend checks and admin tools:

- `server/server.js` — startup validation warning
- `server/routes/settings.js` — Drive status and Drive test endpoints
- `server/utils/generateDriveToken.js` — refresh token generator

## Important notes

- Do **not** put these credentials in the frontend.
- Do **not** hardcode these values in source files.
- Only store them in `server/.env` or the existing backend secret/config pattern.
- Restart the backend after changing `.env`.

---

## Step 1: Prepare the new Google Cloud OAuth client

If you are using a **brand-new OAuth client** for the new Google account:

1. Open Google Cloud Console:
   - https://console.cloud.google.com/apis/credentials
2. Select the correct Google Cloud project.
3. Make sure the **Google Drive API** is enabled.
4. Create or open an **OAuth 2.0 Client ID**.
5. Add this redirect URI:

```text
http://localhost:3000/oauth2callback
```

6. Open the OAuth consent screen settings.
7. Add the **new Google account** as a test user if the app is still in Testing mode.
8. Download the OAuth client JSON file.
9. Place it in:

```text
server/secrets/
```

Example filename:

```text
server/secrets/client_secret_xxx.apps.googleusercontent.com.json
```

You may use the JSON file as reference, but the app still supports direct `.env` values for `GDRIVE_CLIENT_ID` and `GDRIVE_CLIENT_SECRET`.

---

## Step 2: Create or confirm the Google Drive folders in the new account

Log in to the **new Google account** and create or confirm these folders:

1. Images folder
2. Documents folder
3. Hauler LOI folder

Copy the folder ID from each Google Drive folder URL.

Example:

```text
https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz
```

Folder ID:

```text
1AbCdEfGhIjKlMnOpQrStUvWxYz
```

Map them to these environment variables:

- Images folder -> `GDRIVE_IMAGE_FOLDER_ID`
- Documents folder -> `GDRIVE_DOCS_FOLDER_ID`
- Hauler LOI folder -> `GDRIVE_HAULER_LOI_FOLDER_ID`

---

## Step 3: Update `server/.env`

Open:

```text
server/.env
```

Replace the old Google Drive values with the new account values:

```env
GDRIVE_CLIENT_ID=your-new-google-oauth-client-id
GDRIVE_CLIENT_SECRET=your-new-google-oauth-client-secret
GDRIVE_REFRESH_TOKEN=your-new-google-oauth-refresh-token
GDRIVE_IMAGE_FOLDER_ID=your-new-images-folder-id
GDRIVE_DOCS_FOLDER_ID=your-new-documents-folder-id
GDRIVE_HAULER_LOI_FOLDER_ID=your-new-hauler-loi-folder-id
```

## Current variable name notes

Use the exact names already expected by the backend:

- `GDRIVE_DOCS_FOLDER_ID` is the correct variable name for documents.
- Do not rename it to `DOC_FOLDER_ID` unless you also change backend code.

---

## Step 4: Generate a new refresh token

The project already includes a helper script:

- `server/utils/generateDriveToken.js`

### Run it

From the `server` folder:

```bash
node utils/generateDriveToken.js
```

### What happens

1. A local callback server starts on port `3000`.
2. A Google authorization URL is opened or printed.
3. Sign in using the **new Google account**.
4. Approve Drive access.
5. After success, the script prints:

```text
GDRIVE_REFRESH_TOKEN=...
```

6. Copy that value into `server/.env`.

### If Google does not return a refresh token

If the script says no refresh token was returned:

1. Go to the Google account permissions page.
2. Revoke the app's access for that Google account.
3. Run the script again.
4. Make sure the OAuth flow requests offline access and consent again.

---

## Step 5: Restart the backend

After saving the new `.env` values:

1. Stop the backend server.
2. Start it again.

This is required because environment variables are read at startup.

---

## Step 6: Verify the configuration in the app

The backend now includes readable validation for missing or incomplete Google Drive config.

### Backend startup check

When the backend starts, it checks whether the required Drive config is present.

If config is incomplete, the server logs a warning and uploads may fall back to local storage.

### Developer Settings checks

In the admin app:

1. Open **Developer Settings**.
2. Open the **Google Drive Access** section.
3. Review the config status message.
4. Run **Drive Test**.

The app should confirm:

- credentials are configured
- folder IDs are valid
- the configured account can access the folders

---

## Expected error messages

If something is missing or broken, the backend now returns readable messages such as:

- `Google Drive configuration incomplete. Missing: ...`
- `Google Drive credentials not configured.`
- `Google Drive folder IDs not configured.`
- `Drive test failed: ...`
- `The file exists but the current Google account has no permission to access it.`
- `File not found in Google Drive.`

---

## Recommended update order

Use this order every time:

1. Create or confirm the new Google Drive folders.
2. Create or confirm the new OAuth client.
3. Add the redirect URI.
4. Generate the new refresh token.
5. Update `server/.env`.
6. Restart the backend.
7. Run the admin Drive test.
8. Test actual upload, preview, and download flows.

---

## Quick checklist

- [ ] New Google account can access all 3 target folders
- [ ] Google Drive API is enabled in Google Cloud
- [ ] OAuth client exists
- [ ] Redirect URI includes `http://localhost:3000/oauth2callback`
- [ ] New `GDRIVE_CLIENT_ID` saved in `server/.env`
- [ ] New `GDRIVE_CLIENT_SECRET` saved in `server/.env`
- [ ] New `GDRIVE_REFRESH_TOKEN` saved in `server/.env`
- [ ] New `GDRIVE_IMAGE_FOLDER_ID` saved in `server/.env`
- [ ] New `GDRIVE_DOCS_FOLDER_ID` saved in `server/.env`
- [ ] New `GDRIVE_HAULER_LOI_FOLDER_ID` saved in `server/.env`
- [ ] Backend restarted
- [ ] Drive test passes
- [ ] Upload test passes
- [ ] View/download test passes

---

## Optional cleanup after switching accounts

After the new account is working:

1. Remove old unused credential values from local notes.
2. Revoke old OAuth access if no longer needed.
3. Confirm the old Google account no longer needs folder ownership or sharing.
4. If `server/.env` still contains old secrets, replace them fully instead of keeping both versions.
