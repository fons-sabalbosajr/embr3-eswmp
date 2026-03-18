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

## Prerequisites

- **Hostinger KVM 2 VPS** — `ssh root@72.61.125.232`
- **Ubuntu 22.04 LTS** (or your installed OS)
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
│  │ /api/*            → proxy         │─┼──▶ localhost:5000 (Express API)
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
         │
         ▼
┌──────────────────┐    ┌────────────────┐
│  PM2 (process    │    │  MongoDB       │
│  manager)        │    │  (port 27017)  │
│  └── embr3-server│    │  DB: embr3_eswmp│
└──────────────────┘    └────────────────┘
```

**URL Routing:**
- `/eswm-pipeline/slfportal/*` → SLF Generators Portal (login, signup, data entry)
- `/eswm-pipeline/admin/*` → Admin Panel (login, dashboard, settings)
- `/api/*` → Express REST API (proxied via Nginx)

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
PORT=5000
MONGODB_URI=mongodb://embr3admin:STRONG_PASSWORD_HERE@127.0.0.1:27017/embr3_eswmp?authSource=admin
JWT_SECRET=generate-a-long-random-string-here
EMAIL_USER=your-gmail@gmail.com
EMAIL_APP_PASS=your-gmail-app-password
CLIENT_URL=https://embr3-onlinesystems.cloud/eswm-pipeline
```

Generate a secure JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

> **Port 5000** must be unique. If another app already uses 5000, change to a different port (e.g., 5050) and update Nginx accordingly.

---

## Build the Front-end

```bash
cd ~/apps/embr3-eswmp/front-end
npm run build
```

This creates a `dist/` folder with static files. Nginx will serve these from the `/eswm-pipeline/` path.

Copy the build output to the web directory:

```bash
sudo mkdir -p /var/www/eswm-pipeline
sudo cp -r ~/apps/embr3-eswmp/front-end/dist/* /var/www/eswm-pipeline/dist/
sudo chown -R www-data:www-data /var/www/eswm-pipeline
```

---

## Configure Nginx Reverse Proxy

Create a server block for `embr3-onlinesystems.cloud`:

```bash
sudo nano /etc/nginx/sites-available/eswm-pipeline
```

```nginx
server {
    listen 80;
    server_name embr3-onlinesystems.cloud;

    client_max_body_size 10M;

    # API proxy — forward to Node.js backend
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Frontend — serve Vite build output
    location /eswm-pipeline/ {
        alias /var/www/eswm-pipeline/dist/;
        try_files $uri $uri/ /eswm-pipeline/index.html;
    }

    # Root redirect to SLF Portal
    location = / {
        return 302 /eswm-pipeline/slfportal/login;
    }
}
```

Enable the site and test:

```bash
sudo ln -s /etc/nginx/sites-available/eswm-pipeline /etc/nginx/sites-enabled/
sudo nginx -t           # Test config — make sure no errors
sudo systemctl reload nginx
```

> **Isolation:** Each app has its own file in `sites-available/`. Enabling/disabling this app's Nginx config has zero impact on other apps.

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
pm2 start server.js --name embr3-server
```

Configure PM2 to restart on reboot:

```bash
pm2 startup                # Follow the printed instructions
pm2 save                   # Save current process list
```

### Useful PM2 Commands

```bash
pm2 list                            # List all processes
pm2 logs embr3-server               # Tail logs
pm2 logs embr3-server --lines 100   # Last 100 log lines
pm2 restart embr3-server            # Restart
pm2 stop embr3-server               # Stop (without removing)
pm2 delete embr3-server             # Remove from PM2
pm2 monit                           # Real-time monitoring
```

> **Isolation:** PM2 manages each app as a named separate process. Restarting `embr3-server` has no effect on other PM2 processes.

---

## Firewall Configuration

Only expose the ports that Nginx needs:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # ports 80 and 443
sudo ufw enable
sudo ufw status
```

**Do NOT expose port 5000 externally.** The Express server should only be accessible via Nginx's reverse proxy on localhost.

**Do NOT expose port 27017 (MongoDB) externally.** It should only be accessible on localhost.

---

## Avoiding Conflicts with Other Apps

### Port Conflicts
Before deploying, check which ports are already in use:

```bash
sudo ss -tlnp | grep LISTEN
```

Make sure your `PORT=5000` isn't taken. If it is, change it in `.env` and the Nginx config.

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
pm2 start server.js --name embr3-server --max-memory-restart 300M
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
cd ~/apps/embr3-eswmp

# Pull latest code
git pull origin main

# Update server dependencies (if package.json changed)
cd server
npm install --production

# Rebuild front-end (if front-end code changed)
cd ../front-end
npm install
npm run build

# Copy new build to nginx directory
sudo cp -r dist/* /var/www/eswm-pipeline/dist/

# Restart the server
pm2 restart embr3-server
```

### Running Seed Scripts

```bash
cd ~/apps/embr3-eswmp/server
node seeds/seedSlfFacilities.js
node seeds/seedDataReferences.js
# etc.
```

### Checking Server Health

```bash
curl http://localhost:5000/api/health
# Should return: {"status":"ok","message":"Server is running"}
```

### Monitoring

```bash
pm2 monit                    # Real-time CPU/memory
pm2 logs embr3-server        # Live logs
df -h                        # Disk usage
free -h                      # Memory usage
```

---

## Troubleshooting

### App won't start
```bash
pm2 logs embr3-server --lines 50     # Check error logs
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
pm2 list                              # Is embr3-server running?
curl http://localhost:5000/api/health  # Can Express respond?
sudo nginx -t                         # Config valid?
sudo tail -f /var/log/nginx/error.log # Check Nginx errors
```

### Port already in use
```bash
sudo ss -tlnp | grep 5000
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
