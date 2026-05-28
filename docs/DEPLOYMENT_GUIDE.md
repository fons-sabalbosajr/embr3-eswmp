# EMBR3 ESWMP — VPS Deployment Guide

> Deployment on **Hostinger KVM 2 VPS** (`72.61.125.232`) at `embr3-onlinesystems.cloud`.

**Live URLs:**
- **SLF Portal:** `https://embr3-onlinesystems.cloud/eswm-pipeline/slfportal`
- **Admin Panel:** `https://embr3-onlinesystems.cloud/eswm-pipeline/admin`

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Server Preparation](#server-preparation)
4. [Install Node.js (Isolated)](#install-nodejs-isolated)
5. [Install MongoDB](#install-mongodb)
6. [Deploy the Application](#deploy-the-application)
7. [Configure Environment Variables](#configure-environment-variables)
8. [Build the Front-end](#build-the-front-end)
9. [Configure Nginx Reverse Proxy](#configure-nginx-reverse-proxy)
10. [SSL with Let's Encrypt](#ssl-with-lets-encrypt)
11. [Process Management with PM2](#process-management-with-pm2)
12. [Firewall Configuration](#firewall-configuration)
13. [Avoiding Conflicts with Other Apps](#avoiding-conflicts-with-other-apps)
14. [Maintenance & Updates](#maintenance--updates)
15. [Troubleshooting](#troubleshooting)
16. [Backup Strategy](#backup-strategy)

---

## VPS Quick Reference (Confirmed Paths)

> These are the **verified, live** paths on the VPS. Use these and stop guessing.

| Item | Value |
|---|---|
| SSH | `ssh root@72.61.125.232` |
| OS | Ubuntu 24.04.4 LTS |
| App user | `embr3_eswm` |
| App root | `/home/embr3_eswm/apps/embr3-eswmp` |
| Server dir | `/home/embr3_eswm/apps/embr3-eswmp/server` |
| Front-end dir | `/home/embr3_eswm/apps/embr3-eswmp/front-end` |
| Nginx static files | `/var/www/eswm-pipeline/dist/` |
| PM2 process name | `embr3-eswmp-api` (ID 18) |
| Express port | `5006` |
| Node version | v22 via nvm (at `/home/embr3_eswm/.nvm`) |

### Standard Update (copy-paste ready)

```bash
# SSH in
ssh root@72.61.125.232

# Switch to app user (nvm + correct environment)
su - embr3_eswm

# Pull latest code
cd /home/embr3_eswm/apps/embr3-eswmp
git pull origin main

# Update server deps (only if package.json changed)
cd server && npm install --production && cd ..

# Rebuild front-end
cd front-end && npm install && npm run build && cd ..

# Deploy build to nginx directory
sudo mkdir -p /var/www/eswm-pipeline/dist
sudo cp -a front-end/dist/. /var/www/eswm-pipeline/dist/
sudo chown -R www-data:www-data /var/www/eswm-pipeline/

# Restart API
pm2 restart embr3-eswmp-api --update-env && pm2 save

# Verify
curl -sS --ipv4 --max-time 5 -w '\nHTTP %{http_code}\n' http://127.0.0.1:5006/api/health
curl -sS --max-time 10 -w '\nHTTP %{http_code}\n' https://embr3-onlinesystems.cloud/eswm-pipeline/api/health
pm2 logs embr3-eswmp-api --lines 20
```

> If your shell prompt still starts with `root@...` when you run PM2, you are managing the root PM2 instance (`/root/.pm2`). The intended deployment user is `embr3_eswm`, so run `su - embr3_eswm` before `pm2 restart`, `pm2 save`, and `pm2 logs` unless the live process was intentionally created under root.

---

## Prerequisites

- **Hostinger KVM 2 VPS** — `ssh root@72.61.125.232`
- **Ubuntu 24.04.4 LTS**
- Domain **`embr3-onlinesystems.cloud`** with DNS A record pointed to `72.61.125.232`
- **Gmail App Password** for the email functionality
- SSH client (PuTTY on Windows, or native `ssh` on Mac/Linux)

---

## Architecture Overview

```
Internet
   │
   ▼
┌─────────────────────────────────────────┐
│         Nginx (port 80/443)             │
│  embr3-onlinesystems.cloud              │
│  ┌────────────────────────────────────┐ │
│  │ /eswm-pipeline/*  → static files  │ │  ← Vite build (dist/)
│  │ /api/*            → proxy         │─┼──▶ localhost:5006 (Express API)
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
         │
         ▼
┌──────────────────┐    ┌────────────────┐
│  PM2 (process    │    │  MongoDB       │
│  manager)        │    │  (port 27017)  │
│  └── embr3-eswmp-api│ │  DB: embr3_eswmp│
└──────────────────┘    └────────────────┘
```

**URL Routing:**
- `/eswm-pipeline/slfportal/*` → SLF Generators Portal (login, signup, data entry)
- `/eswm-pipeline/admin/*` → Admin Panel (login, dashboard, settings)
- `/eswm-pipeline/api/*` → Express REST API (rewritten & proxied via Nginx to port 5006)

---

## Server Preparation

SSH into your VPS:

```bash
ssh root@72.61.125.232
```

Update and install essentials:

```bash
apt update && apt upgrade -y
apt install -y git curl wget build-essential nginx certbot python3-certbot-nginx
```

### Create a Dedicated User (Recommended)

Running apps as root is a security risk. Create a dedicated user:

```bash
adduser embr3_eswm
usermod -aG sudo embr3_eswm
```

> **Important:** You must start a **fresh login session** after adding the user to the sudo group. The group change does NOT take effect until the user logs out and back in.

```bash
# Start a new login session (this refreshes group membership)
su - embr3_eswm

# Verify sudo access works
sudo whoami   # Should print: root
```

> All application commands below should be run as the `embr3_eswm` user, NOT as root.

---

## Install Node.js (Isolated)

Use **nvm** to manage Node.js versions without affecting other apps:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc

# Install Node.js LTS
nvm install 22
nvm use 22
nvm alias default 22

# Verify
node -v   # v22.x.x
npm -v    # 10.x.x
```

> **Why nvm?** If other apps on the VPS use a different Node version, nvm keeps them isolated. Each user can have its own Node version.

---

## Install MongoDB

If MongoDB isn't already installed on the VPS:

```bash
# Import MongoDB GPG key
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

# Add repository
echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

sudo apt update
sudo apt install -y mongodb-org

# Start and enable
sudo systemctl start mongod
sudo systemctl enable mongod

# Verify
mongosh --eval "db.runCommand({ ping: 1 })"
```

### Secure MongoDB

By default MongoDB listens on localhost only (safe). To add authentication:

```bash
mongosh
```

```js
use admin
db.createUser({
  user: "embr3admin",
  pwd: "STRONG_PASSWORD_HERE",
  roles: [{ role: "readWrite", db: "embr3_eswmp" }]
})
exit
```

Enable auth in `/etc/mongod.conf`:

```yaml
security:
  authorization: enabled
```

```bash
sudo systemctl restart mongod
```

Update your connection string to include credentials:
```
MONGODB_URI=mongodb://embr3admin:STRONG_PASSWORD_HERE@127.0.0.1:27017/embr3_eswmp?authSource=admin
```

> **Note:** This database is completely isolated. Other apps use their own databases and credentials.

---

## Deploy the Application

```bash
# Create app directory (as embr3 user)
mkdir -p ~/apps
cd ~/apps

# Clone the repository
git clone <your-repo-url> embr3-eswmp
cd embr3-eswmp

# Install server dependencies
cd server
npm install --production

# Install front-end dependencies & build
cd ../front-end
npm install
npm run build
```

---

## Configure Environment Variables

Create the server `.env` file:

```bash
cd ~/apps/embr3-eswmp/server
nano .env
```

```env
PORT=5006
MONGODB_URI=mongodb://embr3admin:STRONG_PASSWORD_HERE@127.0.0.1:27017/embr3_eswmp?authSource=admin
JWT_SECRET=generate-a-long-random-string-here
EMAIL_USER=your-gmail@gmail.com
EMAIL_APP_PASS=your-gmail-app-password
CLIENT_URL=https://embr3-onlinesystems.cloud/eswm-pipeline
PUBLIC_API_BASE_PATH=/eswm-pipeline/api

# Google Drive upload storage
GDRIVE_CLIENT_ID=your-google-oauth-client-id
GDRIVE_CLIENT_SECRET=your-google-oauth-client-secret
GDRIVE_REFRESH_TOKEN=your-google-oauth-refresh-token
GDRIVE_OAUTH_CLIENT_JSON=/home/embr3_eswm/apps/embr3-eswmp/server/secrets/client_secret_xxx.apps.googleusercontent.com.json
GDRIVE_IMAGE_FOLDER_ID=google-drive-folder-id-for-images
GDRIVE_DOCS_FOLDER_ID=google-drive-folder-id-for-documents
GDRIVE_HAULER_LOI_FOLDER_ID=google-drive-folder-id-for-hauler-loi

# Optional service-account fallback. Share the folders above with the service
# account email, then point this to the JSON key file.
# GDRIVE_SERVICE_ACCOUNT_KEY_FILE=/home/embr3_eswm/apps/embr3-eswmp/server/secrets/embr3-eswm-account.json
```

Generate a secure JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

> **Port 5006** is used for ESWMP on the live VPS.

### Google Drive Upload Configuration

The front-end `.env` is only for browser-safe Vite values, such as `VITE_GOOGLE_MAPS_API_KEY`. Google Drive upload is handled by the Express server, so the `GDRIVE_*` values must be set in:

```bash
/home/embr3_eswm/apps/embr3-eswmp/server/.env
```

The upload code first tries OAuth:

```env
GDRIVE_CLIENT_ID=...
GDRIVE_CLIENT_SECRET=...
GDRIVE_REFRESH_TOKEN=...
# Or point the runtime to the downloaded OAuth client JSON:
GDRIVE_OAUTH_CLIENT_JSON=/home/embr3_eswm/apps/embr3-eswmp/server/secrets/client_secret_xxx.apps.googleusercontent.com.json
```

Then it requires these target folders:

```env
GDRIVE_IMAGE_FOLDER_ID=...
GDRIVE_DOCS_FOLDER_ID=...
GDRIVE_HAULER_LOI_FOLDER_ID=...
```

If OAuth fails with `invalid_grant`, the refresh token is expired/revoked. Common causes are regenerating the OAuth client secret, revoking account access, or leaving the OAuth consent app in Testing mode. For production, publish the OAuth consent screen to Production or configure the service-account fallback.

For service-account fallback:

1. Create a Google Cloud service account with Drive API enabled.
2. Download the JSON key to a private server path, for example:

```bash
mkdir -p /home/embr3_eswm/apps/embr3-eswmp/server/secrets
nano /home/embr3_eswm/apps/embr3-eswmp/server/secrets/embr3-eswm-account.json
chmod 600 /home/embr3_eswm/apps/embr3-eswmp/server/secrets/embr3-eswm-account.json
```

3. Share each Google Drive target folder with the service account email from the JSON file.
4. Add this to `server/.env`:

```env
GDRIVE_SERVICE_ACCOUNT_KEY_FILE=/home/embr3_eswm/apps/embr3-eswmp/server/secrets/embr3-eswm-account.json
```

After editing `server/.env`, restart PM2 with the updated environment:

```bash
cd /home/embr3_eswm/apps/embr3-eswmp/server
pm2 restart embr3-eswmp-api --update-env
pm2 save
```

Quick Drive configuration check without printing secret values:

```bash
cd /home/embr3_eswm/apps/embr3-eswmp/server
node -e 'require("dotenv").config(); const keys=["GDRIVE_CLIENT_ID","GDRIVE_CLIENT_SECRET","GDRIVE_REFRESH_TOKEN","GDRIVE_IMAGE_FOLDER_ID","GDRIVE_DOCS_FOLDER_ID","GDRIVE_HAULER_LOI_FOLDER_ID","GDRIVE_SERVICE_ACCOUNT_KEY_FILE"]; for (const k of keys) console.log(k, process.env[k] ? "set" : "missing")'
```

---

## Build the Front-end

```bash
cd ~/apps/embr3-eswmp/front-end
npm run build
```

This creates a `dist/` folder with static files. Nginx will serve these from the `/eswm-pipeline/` path.

Copy the build output to the web directory:

```bash
sudo mkdir -p /var/www/eswm-pipeline/dist
sudo cp -a ~/apps/embr3-eswmp/front-end/dist/. /var/www/eswm-pipeline/dist/
sudo chown -R www-data:www-data /var/www/eswm-pipeline
```

> **Note:** The live VPS serves ESWMP from `/var/www/eswm-pipeline/dist/`. Copying only to `/var/www/eswm-pipeline/` can leave the public site on an older build.

---

## Configure Nginx Reverse Proxy

The VPS uses a **single shared Nginx config** for all apps on `embr3-onlinesystems.cloud`.

```bash
sudo nano /etc/nginx/sites-available/eswm-pipeline
```

The ESWMP section within the shared config:

```nginx
    # ══════════════════════════════════════════════════════════════════
    # ESWMP – Ecological Solid Waste Management Pipeline (port 5006)
    # ══════════════════════════════════════════════════════════════════

    # ── Bare /eswm-pipeline → trailing slash ─────────────────────────
    location = /eswm-pipeline {
        return 301 /eswm-pipeline/;
    }

    # ── ESWMP Front-end (static SPA) ────────────────────────────────
    location /eswm-pipeline/ {
        alias /var/www/eswm-pipeline/dist/;
        index index.html;
        try_files $uri $uri/ /eswm-pipeline/index.html;
    }

    # ── ESWMP API reverse proxy ─────────────────────────────────────
    location /eswm-pipeline/api/ {
        rewrite ^/eswm-pipeline/api/(.*) /api/$1 break;
        proxy_pass         http://127.0.0.1:5006;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        client_max_body_size 200M;
        proxy_request_buffering off;
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }
```

For SLF media/document uploads, keep the API proxy upload limit and timeouts at 200 MB. A lower `client_max_body_size` can make 40 MB+ uploads stall or fail before the Express API receives the file.

After editing, test and reload:

```bash
sudo nginx -t           # Test config — make sure no errors
sudo systemctl reload nginx
```

> **Important:** This is a shared config with HRPMS (5000), OCSM (5001), and AQM (3001). Only edit the ESWMP section. Always run `nginx -t` before reloading.

---

## SSL with Let's Encrypt

```bash
sudo certbot --nginx -d embr3-onlinesystems.cloud
```

Certbot will:
1. Obtain an SSL certificate.
2. Automatically modify your Nginx config to redirect HTTP → HTTPS.
3. Set up auto-renewal.

Verify auto-renewal:

```bash
sudo certbot renew --dry-run
```

> **Note:** Certbot modifies **only** the server block for your domain. Other apps' SSL configs are untouched.

---

## Process Management with PM2

Install PM2 globally:

```bash
npm install -g pm2
```

Start the EMBR3 server:

```bash
cd ~/apps/embr3-eswmp/server
pm2 start server.js --name embr3-eswmp-api
```

Configure PM2 to restart on reboot:

```bash
pm2 startup                # Follow the printed instructions
pm2 save                   # Save current process list
```

### Useful PM2 Commands

```bash
pm2 list                            # List all processes
pm2 logs embr3-eswmp-api            # Tail logs
pm2 logs embr3-eswmp-api --lines 100 # Last 100 log lines
pm2 restart embr3-eswmp-api         # Restart
pm2 stop embr3-eswmp-api            # Stop (without removing)
pm2 delete embr3-eswmp-api          # Remove from PM2
pm2 monit                           # Real-time monitoring
```

> **Isolation:** PM2 manages each app as a named separate process. Restarting `embr3-eswmp-api` has no effect on other PM2 processes.

---

## Firewall Configuration

Only expose the ports that Nginx needs:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # ports 80 and 443
sudo ufw enable
sudo ufw status
```

**Do NOT expose port 5006 externally.** The Express server should only be accessible via Nginx's reverse proxy on localhost.

**Do NOT expose port 27017 (MongoDB) externally.** It should only be accessible on localhost.

---

## Avoiding Conflicts with Other Apps

### Port Conflicts
Before deploying, check which ports are already in use:

```bash
sudo ss -tlnp | grep LISTEN
```

Make sure your `PORT=5006` isn't taken. If it is, change it in `.env` and the Nginx config.

### Nginx Conflicts
- Each app should have its **own** file in `/etc/nginx/sites-available/`.
- Never edit another app's config.
- Always run `sudo nginx -t` before reloading Nginx.

### Node.js Version Conflicts
- Use **nvm** per-user to manage Node versions.
- Don't install Node globally via `apt install nodejs` if other apps depend on specific versions.

### MongoDB Conflicts
- Each app uses its **own database** (e.g., `embr3_eswmp`).
- Create separate MongoDB users with `readWrite` permissions scoped to their own database only.
- Never share database credentials between apps.

### Process Conflicts
- Use **PM2** with unique process names.
- Set `max_memory_restart` if the VPS has limited RAM:

```bash
pm2 start server.js --name embr3-eswmp-api --max-memory-restart 300M
```

### Disk & Log Rotation
Prevent logs from filling the disk:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

---

## Maintenance & Updates

### Deploying Updates

```bash
cd /home/embr3_eswm/apps/embr3-eswmp

# Pull latest code
git pull origin main

# Update server dependencies (if package.json changed)
cd server
npm install --production

# Rebuild front-end (if front-end code changed)
cd ../front-end
npm install
npm run build

# Copy new build to nginx directory (dist/ subdirectory required)
sudo mkdir -p /var/www/eswm-pipeline/dist
sudo cp -a dist/. /var/www/eswm-pipeline/dist/
sudo chown -R www-data:www-data /var/www/eswm-pipeline/

# Restart the server (actual PM2 process name: embr3-eswmp-api, port: 5006)
pm2 restart embr3-eswmp-api --update-env && pm2 save
```

### Quick Redeploy (Copy Pre-built from Local)

If you've already built on your local machine and are uploading via SCP/SFTP:

```bash
# 1. On your LOCAL machine — upload the built files
ssh root@72.61.125.232 'mkdir -p /var/www/eswm-pipeline/dist'
scp -r front-end/dist/* root@72.61.125.232:/var/www/eswm-pipeline/dist/
scp -r server/* root@72.61.125.232:/home/embr3_eswm/apps/embr3-eswmp/server/

# 2. SSH into VPS
ssh root@72.61.125.232

# 3. Fix ownership of uploaded files
sudo chown -R www-data:www-data /var/www/eswm-pipeline/
sudo chown -R embr3_eswm:embr3_eswm /home/embr3_eswm/apps/embr3-eswmp/server/

# 4. Install server dependencies (if package.json changed)
cd /home/embr3_eswm/apps/embr3-eswmp/server
npm install --production

# 5. Re-seed SLF data (IMPORTANT after seed script changes)
node seeds/seedSlfFacilities.js

# 6. Start or restart the server (PM2 process: embr3-eswmp-api, port 5006)
pm2 start server.js --name embr3-eswmp-api   # first time
pm2 restart embr3-eswmp-api --update-env      # subsequent deploys
pm2 save

# 7. Verify
curl -sS --ipv4 --max-time 5 -w '\nHTTP %{http_code}\n' http://127.0.0.1:5006/api/health
curl -sS --max-time 10 -w '\nHTTP %{http_code}\n' https://embr3-onlinesystems.cloud/eswm-pipeline/api/health
pm2 logs embr3-eswmp-api --lines 20
```

### Running Seed Scripts

After reseeding, the SLF portal users' facility references (ObjectIds) become stale.
The system auto-recovers by falling back to name-based lookup on the next portal login.
No manual intervention is needed.

```bash
cd ~/apps/embr3-eswmp/server

# SLF facilities (reads from per-year Excel files, merges duplicates)
node seeds/seedSlfFacilities.js

# Other seed scripts
node seeds/seedDataReferences.js
# etc.
```

### Checking Server Health

```bash
curl -sS --ipv4 --max-time 5 -w '\nHTTP %{http_code}\n' http://127.0.0.1:5006/api/health
# Should return: {"status":"ok","message":"Server is running"}
curl -sS --max-time 10 -w '\nHTTP %{http_code}\n' https://embr3-onlinesystems.cloud/eswm-pipeline/api/health
# Should also return HTTP 200 through Nginx
```

### Monitoring

```bash
pm2 monit                    # Real-time CPU/memory
pm2 logs embr3-eswmp-api     # Live logs
df -h                        # Disk usage
free -h                      # Memory usage
```

---

## Troubleshooting

### App won't start
```bash
pm2 logs embr3-eswmp-api --lines 50  # Check error logs
cd ~/apps/embr3-eswmp/server
node server.js                        # Run directly to see errors
```

### MongoDB connection error
```bash
sudo systemctl status mongod          # Is it running?
mongosh                                # Can you connect locally?
```

### Nginx 502 Bad Gateway
```bash
pm2 list                              # Is embr3-eswmp-api running?
curl -sS --ipv4 --max-time 5 -w '\nHTTP %{http_code}\n' http://127.0.0.1:5006/api/health  # Can Express respond?
sudo nginx -t                         # Config valid?
sudo tail -f /var/log/nginx/error.log # Check Nginx errors
```

### Health check prints nothing
```bash
# Force IPv4 and show the HTTP status/body
curl -i --ipv4 --max-time 5 http://127.0.0.1:5006/api/health

# Check whether PM2 is being managed by root or the app user
whoami
pm2 list
pm2 describe embr3-eswmp-api | grep -E "cwd|script path|interpreter|status"
```

If `whoami` prints `root` and PM2 logs live under `/root/.pm2`, you are using root's PM2 process list. Either continue consistently as root for this existing process, or migrate it once to the app user:

```bash
# As root, stop only this app's root-owned process
pm2 stop embr3-eswmp-api
pm2 delete embr3-eswmp-api

# Start it under the intended app user
su - embr3_eswm
cd /home/embr3_eswm/apps/embr3-eswmp/server
pm2 start server.js --name embr3-eswmp-api --update-env
pm2 save
```

### Port already in use
```bash
sudo ss -tlnp | grep 5006
# Kill conflicting process or change PORT in .env
```

### Email not sending
- Verify `EMAIL_USER` and `EMAIL_APP_PASS` in `.env`.
- Make sure "Less secure app access" is off and you're using an App Password.
- Check PM2 logs for email error messages.

### SSL certificate renewal issues
```bash
sudo certbot renew --dry-run
sudo certbot renew --force-renewal    # Force renewal if needed
```

---

## Backup Strategy

### Database Backup

Create a backup script:

```bash
nano ~/backup-embr3.sh
```

```bash
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=~/backups/embr3
mkdir -p $BACKUP_DIR
mongodump --db embr3_eswmp --out "$BACKUP_DIR/dump_$TIMESTAMP" --uri="mongodb://embr3admin:STRONG_PASSWORD_HERE@127.0.0.1:27017/embr3_eswmp?authSource=admin"
# Keep only last 7 backups
ls -dt $BACKUP_DIR/dump_* | tail -n +8 | xargs rm -rf
echo "Backup completed: dump_$TIMESTAMP"
```

```bash
chmod +x ~/backup-embr3.sh
```

Schedule daily backups via cron:

```bash
crontab -e
# Add this line (runs daily at 2 AM):
0 2 * * * /home/embr3/backup-embr3.sh >> /home/embr3/backups/embr3/backup.log 2>&1
```

### Restore from Backup

```bash
mongorestore --db embr3_eswmp ~/backups/embr3/dump_XXXXXXXXXX/embr3_eswmp --uri="mongodb://embr3admin:STRONG_PASSWORD_HERE@127.0.0.1:27017/embr3_eswmp?authSource=admin" --drop
```

---

*© 2026 EMBR3 — Environmental Management Bureau Region III. All rights reserved.*
