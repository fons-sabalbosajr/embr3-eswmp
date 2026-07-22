# EMBR3 ESWMP — Technical Overview

**Ecological Solid Waste Management Pipeline (ESWMP)** — technical reference for developers, maintainers, system administrators, and technical reviewers.

> For a non-technical summary see [SYSTEM_PROJECT_OVERVIEW.md](SYSTEM_PROJECT_OVERVIEW.md), and for admin usage see [ADMIN_GUIDE.md](ADMIN_GUIDE.md). Deployment and operations are covered by an internal runbook maintained outside this repository.

Current version: **1.4.0** (from `front-end/package.json` and `server/package.json`).

---

## Architecture Overview

The application is a two-part web system sharing one repository:

- **Frontend** — a React single-page application (Vite build) that serves both the **Admin dashboard** (`/admin`) and the **SLF Generators Portal** (`/slfportal`) under the base path `/eswm-pipeline/`.
- **Backend** — an Express REST API backed by MongoDB (via Mongoose), with real-time updates over Socket.IO.
- **Authentication** — JSON Web Tokens (JWT). The admin side and the portal side use separate tokens.
- **API structure** — REST endpoints under `/api/...`, mounted per feature module (see *API Overview*).
- **Real-time communication** — Socket.IO rooms push data-refresh and notification events to admin and portal clients.
- **File storage** — Google Drive (via the Google APIs client) with a local upload fallback; uploads are handled with Multer.
- **Deployment structure** — the frontend is built to static assets and served by a web server (e.g., Nginx); the backend runs as a Node.js process (e.g., under a process manager). Details are environment-specific and documented in an internal deployment runbook (not included in this repository).
- **Environment configuration** — all secrets and environment-specific values are read from a server `.env` file (never committed). A template is provided in `server/.env.example`.

```
Browser (Admin / SLF Portal SPA, React + Vite)
        │  HTTPS (REST /api)      │  WebSocket (Socket.IO)
        ▼                         ▼
Express API (server/) ──────── Socket.IO
        │
        ├── MongoDB (Mongoose models)
        ├── Google Drive (file storage) + local fallback
        ├── Email (SMTP / Gmail via Nodemailer)
        └── AI provider (Automation Agent, optional)
```

---

## Technology Stack

Versions are taken from the `package.json` files where safely available.

| Layer | Technology | Purpose | Version |
|---|---|---|---|
| Frontend | React | UI framework | ^19.2 |
| Build tooling | Vite + `@vitejs/plugin-react` | Dev server and production build | ^7.3 |
| Routing | React Router | Client-side routing | ^7.13 |
| UI library | Ant Design (`antd`) + `@ant-design/icons` | Component library | ^6.3 |
| Charts | Recharts | Dashboard charts | ^3.8 |
| Mapping | Leaflet + React-Leaflet | SLF location maps | ^1.9 / ^5.0 |
| Mapping | `@react-google-maps/api` | Google Maps integration | ^2.20 |
| Calendar | FullCalendar (`@fullcalendar/*`) | Disposal calendar | ^6.1 |
| Alerts | SweetAlert2 | Dialogs and confirmations | ^11.26 |
| HTTP client | Axios | API requests | ^1.13 |
| Real-time (client) | `socket.io-client` | Live updates | ^4.8 |
| Spreadsheet | SheetJS (`xlsx`) | Excel import/export | 0.20.3 |
| Dates | Day.js | Date handling | ^1.11 |
| Backend | Node.js + Express | REST API server | Express ^5.2 |
| Database | MongoDB via Mongoose | Data persistence | Mongoose ^9.3 |
| Authentication | `jsonwebtoken` + `bcryptjs` | JWT auth + password hashing | ^9.0 / ^3.0 |
| Real-time (server) | Socket.IO | Live updates | ^4.8 |
| Uploads | Multer | Multipart file handling | ^2.1 |
| File storage | `googleapis` | Google Drive storage | ^171.4 |
| Email | Nodemailer | Transactional email | ^9.0 |
| Security | Helmet + `express-rate-limit` | Headers + rate limiting | ^8.3 / ^8.5 |
| AI (optional) | `@anthropic-ai/sdk`, `@google/genai` | Automation Agent providers | ^0.112 / ^2.13 |
| Config | `dotenv` | Environment variables | ^17.3 |
| Dev tooling | Nodemon | Backend auto-reload | ^3.1 |
| Testing | — | No automated test suite is configured (`To be verified`). | — |

---

## Project Structure

Major directories (not every file is listed):

```
embr3-eswmp/
├── front-end/                 # React + Vite single-page application
│   ├── src/
│   │   ├── pages/             # Route-level pages (Landing, admin/, SLFPortal/, AdminHome/, auth pages)
│   │   ├── components/        # Shared UI components
│   │   ├── utils/             # Shared client utilities (units, formatting, status, masking)
│   │   ├── assets/            # Static assets
│   │   ├── api.js             # Axios instance (base URL, auth headers)
│   │   ├── App.jsx / main.jsx # App bootstrap and routes
│   │   └── *.css              # Global styles
│   └── package.json
├── server/                    # Express REST API
│   ├── routes/                # API route modules (one file per feature area)
│   ├── models/                # Mongoose schemas / data models
│   ├── middleware/            # Auth and authorization middleware
│   ├── utils/                 # Server utilities (email, storage, sockets, units, agent, security)
│   ├── seeds/                 # One-off seed scripts
│   ├── server.js              # App entry point (Express + Socket.IO)
│   └── .env.example           # Environment variable template (no secrets)
├── docs/                      # Project documentation (this folder)
├── CHANGELOG.md
└── README.md
```

> The frontend has no separate "controllers"/"hooks"/"context" top-level folders; page-level state and logic live within the `pages/` feature folders (e.g., `pages/SLFPortal/`, `pages/admin/`). The backend follows a **routes + models + middleware + utils** layout rather than a separate controllers layer.

---

## User Roles and Authorization

Admin-side accounts (`User` model) have one of three roles:

| Role | Access |
|---|---|
| `developer` | Full access, including developer-only settings and tooling. Bypasses granular permission checks. |
| `admin` | EMB administrator access to the dashboard, submission review, and monitoring. |
| `user` | Standard admin-side account with permission-gated access. |

Portal accounts (`UserPortal` model) authenticate separately and are scoped to their own facility's data.

Authorization is enforced server-side in `server/middleware/auth.js`, which provides `authMiddleware` (valid token required), `requireAnyAuth` (admin **or** portal token), `adminOnly` (admin or developer), `developerOnly` (developer only), and `requirePermission` (granular per-feature checks). Portal endpoints scope reads and writes to the authenticated portal user so one user's data is never exposed to another.

---

## Core Data Models

Main verified models (`server/models/`):

| Model | Purpose |
|---|---|
| `User` | Admin-side accounts and roles. |
| `UserPortal` | SLF portal accounts. |
| `SlfFacility` / `SLFGenerator` | Sanitary landfill facilities and generators. |
| `DataSLF` | Disposal submissions (the core record: dates, trucks, waste types, volumes, cells, status). |
| `PortalSubmissionQueue` | Draft and scheduled submissions awaiting processing. |
| `SlfClient` | LGU and private-sector waste-source clients. |
| `PortalMessage` / `MessageThread` | Portal messaging between EMB and users. |
| `Notification` | Admin notifications. |
| `AppSettings` | Application, portal, email, integration, announcement, and masking settings (single document). |
| `AutomationAgentUsageLog` | Usage records for the read-only Automation Agent. |
| `Region3Lgu`, `SlfDataIssue`, `SlfSyncJob`, `HaulerDeleteRequest`, `SupportTicket`, `DataHistory`, `Transaction`, `AppLog` | Supporting reference, audit, and workflow data. |

Additional EMB data-set models exist (e.g., `TenYearSWMPlan`, `FundedMRF`, `LguInitiatedMRF`, `TrashTrap`, `TransferStation`, `OpenDumpsite`, `ResidualContainment`, `ProjectDescScoping`, `TechnicalAssistance`, `LguAssistDiversion`, `SwmEquipment`).

> Group submissions are **derived**, not a separate collection: records that share a batch identifier (`submissionId`) are grouped for display. See `front-end/src/pages/SLFPortal/submissionGrouping.js`.

Data models must never be documented with real records or credentials; use sample names such as `SLF ABC`, `Company ABC`, or `Municipality ABC`.

---

## API Overview

All routes are mounted under `/api` (see `server/server.js`). Main groups:

| Route group | Purpose |
|---|---|
| `/api/auth` | Admin authentication (login, signup, password reset). Rate-limited. |
| `/api/portal-auth` | Portal authentication and read endpoints. Rate-limited. |
| `/api/data-slf` | Disposal submissions (create, review, acknowledge, revert). |
| `/api/settings` | Application settings, announcements, masking toggle, portal fields. |
| `/api/slf-facilities`, `/api/slf-clients` | Facility and client monitoring, relationship data. |
| `/api/notifications`, `/api/messages`, `/api/portal-*` | Notifications and portal messaging. |
| `/api/developer/automation-agent/*`, `/api/automation-agent/query` | Automation Agent settings, connection test, and read-only queries. |
| `/api/upload` | File uploads (Drive / local fallback). |
| Other feature groups | `/api/transactions`, `/api/region3-lgu`, `/api/ten-year-swm`, `/api/funded-mrf`, `/api/trash-traps`, and similar EMB data modules. |

Documentation must use generalized routes and must never include secrets, tokens, private hostnames, internal IP addresses, or production credentials.

---

## Submission Lifecycle

The `DataSLF.status` field uses these **verified** values: `pending`, `acknowledged`, `rejected`, `revert_requested`, `reverted`.

| Stage | Meaning |
|---|---|
| **Draft** | Saved but not submitted; held in `PortalSubmissionQueue` (also used for scheduled submissions). |
| **Submitted → Pending** | On submission, a record is created with status `pending`, awaiting admin review. |
| **Acknowledged** | An admin has reviewed and accepted the record (`acknowledged`). |
| **Reverted** | An admin returned the record for correction (`reverted`); a related `revert_requested` state marks a user-requested edit. |
| **Resubmitted** | The user edits a reverted record and submits again; the new record references the prior one (via `previousIdNos`), so resubmissions are traceable. |
| **Rejected** | A record marked `rejected`. |
| **Restricted / non-operational handling** | Portal access can be gated by maintenance modes and settings; non-operational or restricted states are handled server-side and surfaced to the user rather than silently failing. |

> The portal UI derives additional display labels (e.g., "Approved", "Edit Approved") from the underlying statuses above; the model enum is the source of truth.

---

## Unit-of-Measurement Logic

Volume handling is centralized in `server/utils/volumeUnits.js` and `front-end/src/utils/volumeUnits.js`:

- **Default unit:** tons (the facility-unit resolver falls back to tons when no unit is set).
- **SLF-specific unit:** each facility declares a baseline unit; portal figures display in that single declared unit rather than showing tons and cubic metres side by side.
- **Conversion:** `1 m³ ≈ 0.2 tons` (`TON_PER_M3 = 0.2`), applied by `convertVolume(value, fromUnit, toUnit)`; `normalizeUnit` canonicalizes unit strings.
- **Historical-unit preservation:** existing records keep the unit they were recorded in; conversions are applied for display and aggregation rather than mutating stored values.
- **Waste-volume aggregation:** denormalized totals (`totalVolumeM3`, `totalVolumeTons`) are maintained on records and summed for dashboards.
- **Mixed-unit handling:** when a group mixes tons and cubic metres, the per-unit totals are kept separate and a `mixedUnits` flag is set so the UI can present them apart with a warning instead of silently adding different units.

---

## Notifications and Messaging

- **Admin notifications** are stored (`Notification` model) and pushed in real time to the admin room.
- **Grouped notifications** consolidate related activity so the admin is not flooded with individual events.
- **Portal messaging** (`PortalMessage` / `MessageThread`) lets EMB send messages to specific portal users; the portal displays them (including via queued dialogs).
- **Read / dismiss behavior** is tracked per notification/message so items can be marked read and dismissed.
- **Real-time communication** is implemented with Socket.IO: `server/utils/socketEmit.js` emits `data-refresh` and notification events to the `admin-room` and to per-user portal rooms (`portal-<email>`), plus a broadcast helper for global setting changes.

---

## Environment Variables

Configure these in `server/.env` (never commit real values). See `server/.env.example` for the full template. **Names only** — actual values must come from your own environment.

```env
# Core
PORT=
MONGODB_URI=
JWT_SECRET=
NODE_ENV=
CLIENT_URL=
PUBLIC_API_BASE_PATH=

# Email (SMTP or Gmail)
EMAIL_USER=
EMAIL_APP_PASS=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
GMAIL_REFRESH_TOKEN=

# Google Drive storage
GDRIVE_CLIENT_ID=
GDRIVE_CLIENT_SECRET=
GDRIVE_REFRESH_TOKEN=
GDRIVE_OAUTH_CLIENT_JSON=
GDRIVE_IMAGE_FOLDER_ID=
GDRIVE_DOCS_FOLDER_ID=
GDRIVE_HAULER_LOI_FOLDER_ID=

# At-rest secret encryption (config secrets stored in the DB)
SECRET_ENCRYPTION_KEY=

# Automation Agent (optional, read-only AI assistant)
AUTOMATION_AGENT_ENABLED=
AUTOMATION_AGENT_DAILY_LIMIT=
AUTOMATION_AGENT_USER_LIMIT=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
ANTHROPIC_MAX_TOKENS=
ANTHROPIC_TEMPERATURE=
ANTHROPIC_TIMEOUT_MS=
GEMINI_API_KEY=
GEMINI_MODEL=
GEMINI_MAX_TOKENS=
GEMINI_TEMPERATURE=
GEMINI_TIMEOUT_MS=
```

Never place real values in documentation. AI provider keys, if used, must be funded provider keys — the Automation Agent never uses a browser login or subscription.

---

## Local Development

Prerequisites: Node.js (LTS), npm, and a reachable MongoDB instance.

```bash
# 1. Backend dependencies
cd server
npm install

# 2. Configure environment
cp .env.example .env      # then fill in values (see Environment Variables)

# 3. Frontend dependencies
cd ../front-end
npm install
```

Run the services (two terminals):

```bash
# Backend (auto-reload)
cd server
npm run dev        # nodemon server.js   (or: npm start)

# Frontend (Vite dev server)
cd front-end
npm run dev
```

Build the frontend for production:

```bash
cd front-end
npm run build      # outputs to front-end/dist/
npm run preview    # preview the production build locally
```

Additional server script: `npm run seed:portal-updates` seeds a portal-updates announcement. There is **no automated test suite** (`server` `npm test` is a placeholder).

---

## Deployment Notes

General requirements (the full procedure is maintained in an internal deployment runbook, not included in this repository):

- A Linux server with Node.js (LTS) and a running MongoDB instance.
- A process manager to keep the Node.js backend running.
- A web server (e.g., Nginx) to serve the built frontend and reverse-proxy the API.
- HTTPS via a valid certificate for the public domain.
- A populated `server/.env` file (kept off version control).

Deployment documentation must not expose server IP addresses, SSH credentials, internal domains, API keys, database connection strings, or private file paths. Use placeholders such as `<your-server-ip>`, `<deploy-user>`, and `your-domain.example`.

---

## Security Considerations

- **Secret management** — all secrets come from environment variables; `.env` is gitignored. Config secrets stored in the database (e.g., an AI provider key entered via the UI) are encrypted at rest with AES-256-GCM using a key derived from `SECRET_ENCRYPTION_KEY` (kept outside the database). See `server/utils/secretBox.js`.
- **Authentication** — JWT-based, with separate admin and portal tokens; passwords hashed with `bcryptjs`.
- **Authorization** — enforced server-side (`adminOnly`, `developerOnly`, `requirePermission`); portal data is scoped per user.
- **Rate limiting** — `express-rate-limit` protects authentication, portal reads, and the Automation Agent endpoints.
- **Input validation** — request payloads are validated and clamped server-side; the Automation Agent accepts only allowlisted read-only functions with bounded parameters (never arbitrary database queries).
- **Sensitive logging** — API keys are never logged in full or returned in API responses; only masked status is exposed. Error messages are sanitized before being returned or stored.
- **Environment file protection** — `.env`, `secrets/`, and OAuth token utilities are gitignored (`server/.gitignore`).
- **Security headers** — set via Helmet.
- **Production configuration** — set `NODE_ENV=production` to strip internal error details from responses; use a dedicated `SECRET_ENCRYPTION_KEY` and a strong `JWT_SECRET`.

---

## Known Limitations

- **No automated test suite** — testing is manual; `server` `npm test` is a placeholder (`To be verified` whether CI exists).
- **External-service dependencies** — email, Google Drive storage, and the Automation Agent require valid external configuration; without it those features are inactive.
- **Automation Agent scope** — read-only only; it cannot modify records, change statuses, send messages, or run arbitrary queries. It is disabled unless explicitly enabled with a valid, funded provider key.
- **Sensitive-value masking coverage** — masking is applied to the portal's primary sensitive surfaces; some secondary surfaces may still be extended via the shared resolver (`Planned` for full coverage — verify against the codebase).
- **Deployment specifics** — production topology, scaling, and backups are environment-specific and out of scope for this document.
