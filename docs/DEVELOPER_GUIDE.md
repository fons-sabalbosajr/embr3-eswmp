# EMBR3 ESWMP — Developer Guide

> **Ecological Solid Waste Management Pipeline**
> Technical reference for developers maintaining or extending the application.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Local Development Setup](#local-development-setup)
5. [Environment Variables](#environment-variables)
6. [API Reference](#api-reference)
7. [Authentication & Authorization](#authentication--authorization)
8. [Database Models](#database-models)
9. [Email System](#email-system)
10. [Developer Settings Panel](#developer-settings-panel)
11. [Adding a New Module](#adding-a-new-module)
12. [Seed Scripts](#seed-scripts)
13. [Coding Conventions](#coding-conventions)

---

## Architecture Overview

```
┌─────────────────┐        ┌──────────────────┐        ┌───────────────┐
│   React SPA     │──API──▶│  Express Server   │──────▶│   MongoDB     │
│  (Vite, port    │  /api  │  (Node.js, port   │       │  (embr3_eswmp)│
│   5173 dev)     │◀───────│   5000)           │◀──────│               │
└─────────────────┘        └──────────────────┘        └───────────────┘
                                    │
                                    ▼
                           ┌──────────────────┐
                           │   Gmail SMTP      │
                           │   (Nodemailer)    │
                           └──────────────────┘
```

- **Front-end:** React 19 SPA with Ant Design 6, served by Vite in development. Built to static files for production.
- **Back-end:** Express 5 REST API with Mongoose 9 ODM.
- **Database:** MongoDB (local or Atlas).
- **Email:** Nodemailer with Gmail App Password.
- **Auth:** JWT tokens stored in encrypted localStorage (CryptoJS AES).

---

## Tech Stack

### Front-end
| Package | Version | Purpose |
|---------|---------|---------|
| React | 19.x | UI framework |
| Vite | 7.x | Build tool & dev server |
| Ant Design (antd) | 6.x | UI component library |
| Axios | 1.x | HTTP client |
| React Router DOM | 7.x | Client-side routing |
| Leaflet / React-Leaflet | 1.9 / 5.x | Interactive maps |
| SweetAlert2 | 11.x | Alert dialogs |
| CryptoJS | 4.x | Client-side encryption |
| dayjs | 1.x | Date formatting |
| xlsx | 0.18.x | Excel export |

### Back-end
| Package | Version | Purpose |
|---------|---------|---------|
| Express | 5.x | HTTP server |
| Mongoose | 9.x | MongoDB ODM |
| jsonwebtoken | 9.x | JWT auth |
| bcryptjs | 3.x | Password hashing |
| Nodemailer | 8.x | Email transport |
| dotenv | 17.x | Env config |
| cors | 2.x | CORS middleware |

---

## Project Structure

```
embr3-eswmp/
├── docs/                     # Documentation
├── front-end/
│   ├── public/               # Static assets
│   ├── src/
│   │   ├── api.js            # Axios instance with interceptor
│   │   ├── App.jsx           # Route definitions
│   │   ├── main.jsx          # Entry point
│   │   ├── pages/
│   │   │   ├── AdminHome.jsx       # Admin layout + dashboard
│   │   │   ├── Login.jsx           # Admin login
│   │   │   ├── Signup.jsx          # Admin registration
│   │   │   ├── VerifyEmail.jsx     # Email verification
│   │   │   ├── SLFPortal.jsx       # Portal main (data entry + history)
│   │   │   └── admin/              # Admin sub-pages (one per module)
│   │   │       ├── SubmissionSettings.jsx
│   │   │       ├── SLFMonitoring.jsx
│   │   │       ├── AccountSettings.jsx
│   │   │       ├── DeveloperSettings.jsx
│   │   │       └── ...
│   │   └── utils/
│   │       ├── secureStorage.js    # CryptoJS encrypted localStorage
│   │       ├── exportExcel.js      # Excel export utility
│   │       └── dataRef.jsx         # Data reference helpers
│   ├── vite.config.js
│   └── package.json
├── server/
│   ├── server.js             # Express app entry, MongoDB connection, routes
│   ├── middleware/
│   │   └── auth.js           # JWT auth, adminOnly, developerOnly
│   ├── models/               # Mongoose schemas
│   │   ├── DataSLF.js        # SLF disposal data entries
│   │   ├── UserPortal.js     # Portal user accounts
│   │   ├── User.js           # Admin user accounts
│   │   ├── Transaction.js    # Activity log entries
│   │   ├── AppSettings.js    # App-wide settings
│   │   └── ...
│   ├── routes/               # Express route handlers
│   │   ├── dataSLF.js        # CRUD for SLF submissions
│   │   ├── portalAuth.js     # Portal auth (signup/login/password reset)
│   │   ├── portalUsers.js    # Admin management of portal users
│   │   ├── auth.js           # Admin auth
│   │   └── ...
│   ├── seeds/                # Database seed scripts
│   ├── utils/
│   │   ├── email.js          # All email templates & transporter
│   │   └── logger.js         # App logging utility
│   └── package.json
```

---

## Local Development Setup

### Prerequisites
- **Node.js** v18+ (LTS recommended)
- **MongoDB** v6+ (local or Atlas connection string)
- **Gmail App Password** for email features

### Steps

```bash
# 1. Clone the repository
git clone <repo-url>
cd embr3-eswmp

# 2. Install server dependencies
cd server
npm install

# 3. Create environment file
cp .env.example .env   # or create manually — see Environment Variables section

# 4. Install front-end dependencies
cd ../front-end
npm install

# 5. Start the server (in server/ directory)
cd ../server
npm run dev          # Uses nodemon, auto-restarts on file changes

# 6. Start the front-end (in front-end/ directory, separate terminal)
cd ../front-end
npm run dev          # Vite dev server on http://localhost:5173
```

The Vite dev server proxies `/api` requests to `http://localhost:5000`.

---

## Environment Variables

Create a `.env` file in the `server/` directory:

```env
# Server
PORT=5000

# MongoDB
MONGODB_URI=mongodb://127.0.0.1:27017/embr3_eswmp

# JWT
JWT_SECRET=your-secure-random-string

# Email (Gmail)
EMAIL_USER=your-gmail@gmail.com
EMAIL_APP_PASS=your-16-char-app-password

# Client URL (for email links)
CLIENT_URL=http://localhost:5173
```

> **Important:** `EMAIL_APP_PASS` is a Gmail App Password, **not** your Gmail password. Generate one at [Google App Passwords](https://myaccount.google.com/apppasswords).

---

## API Reference

All endpoints are prefixed with `/api`.

### Authentication — Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup` | Register new admin user |
| POST | `/api/auth/login` | Admin login, returns JWT |
| GET | `/api/auth/me` | Get current admin user |

### Authentication — Portal
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/portal-auth/signup` | Register portal user (pending approval) |
| POST | `/api/portal-auth/login` | Portal user login |
| GET | `/api/portal-auth/me` | Get current portal user |
| GET | `/api/portal-auth/my-submissions` | Get portal user's submission history |
| POST | `/api/portal-auth/forgot-password` | Request password reset |
| POST | `/api/portal-auth/reset-password` | Reset password with token |

### SLF Data (Submissions)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/data-slf` | Submit disposal data (portal) |
| GET | `/api/data-slf` | Get all entries (admin) |
| GET | `/api/data-slf/stats` | Dashboard statistics |
| PATCH | `/api/data-slf/:id/status` | Acknowledge/reject single entry |
| PATCH | `/api/data-slf/bulk-status` | Bulk acknowledge/reject entries |
| DELETE | `/api/data-slf/:id` | Delete an entry |

### Portal Users (Admin)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/portal-users` | List all portal users |
| PATCH | `/api/portal-users/:id/approve` | Approve & assign SLF |
| PATCH | `/api/portal-users/:id/reject` | Reject portal user |
| DELETE | `/api/portal-users/:id` | Delete portal user |

### Other Modules
| Prefix | Module |
|--------|--------|
| `/api/ten-year-swm` | 10-Year SWM Plan |
| `/api/funded-mrf` | Funded MRF |
| `/api/lgu-initiated-mrf` | LGU-Initiated MRF |
| `/api/trash-traps` | Trash Traps |
| `/api/swm-equipment` | SWM Equipment |
| `/api/slf-facilities` | SLF Facilities |
| `/api/slf-generators` | SLF Generators |
| `/api/data-references` | Data References |
| `/api/open-dumpsites` | Open Dump Sites |
| `/api/residual-containment` | Residual Containment |
| `/api/project-desc-scoping` | PDS Scoping |
| `/api/transfer-stations` | Transfer Stations |
| `/api/lgu-assist-diversion` | LGU Assist & Diversion |
| `/api/technical-assistance` | Technical Assistance |
| `/api/settings` | App settings |
| `/api/users` | Admin user management |
| `/api/logs` | Application logs |
| `/api/transactions` | Transaction history |

---

## Authentication & Authorization

### Dual Token System

The app uses two independent JWT token namespaces:

| Scope | Storage Key | Token Key | Issued At |
|-------|-------------|-----------|-----------|
| **Admin** | `token`, `user` | `secureStorage.get("token")` | `/api/auth/login` |
| **Portal** | `portal_token`, `portal_user` | `secureStorage.get("portal_token")` | `/api/portal-auth/login` |

Both share the same `JWT_SECRET` but have different payloads:
- Admin: `{ id, role }` where role is `developer`, `admin`, or `user`
- Portal: `{ id, role: "portal_user" }`

### Axios Interceptor (`api.js`)

The axios instance attaches the **admin** token automatically via interceptor, but **only if** the request doesn't already have an `Authorization` header set explicitly. Portal pages set their own header to use the portal token.

### Server Middleware (`auth.js`)

```js
authMiddleware   // Verifies JWT, attaches req.user
adminOnly        // Requires role = admin or developer
developerOnly    // Requires role = developer
```

---

## Database Models

### Key Collections

| Model | Collection | Description |
|-------|------------|-------------|
| `User` | `users` | Admin panel users |
| `UserPortal` | `user_portal` | Portal (SLF generator) users |
| `DataSLF` | `dataslfs` | Disposal data entries |
| `SlfFacility` | `slf_facilities` | SLF facility records |
| `SLFGenerator` | `slfgenerators` | SLF generator master list |
| `Transaction` | `transactions` | Activity log/audit trail |
| `AppSettings` | `appsettings` | Singleton app configuration |
| `PortalField` | `portalfields` | Configurable portal form fields |
| `DataReference` | `datareferences` | Lookup/dropdown values |

### DataSLF Schema (Core)
```
slfGenerator    → ObjectId ref SLFGenerator
submissionId    → String (e.g., "SUB-1710000000000-a1b2c3")
idNo            → String (auto-generated: "SLF-XX-LGU-0001")
dateOfDisposal  → Date (required)
lguCompanyName  → String (required)
companyType     → "LGU" | "Private"
address         → String
trucks          → [{ disposalTicketNo, hauler, plateNumber, truckCapacity,
                     truckCapacityUnit, actualVolume, actualVolumeUnit, wasteType }]
status          → "pending" | "acknowledged" | "rejected"
submittedBy     → String (email of portal user)
timestamps      → createdAt, updatedAt
```

---

## Email System

All email templates are in `server/utils/email.js` using Nodemailer with Gmail SMTP.

### Templates

| Function | Trigger | Recipient |
|----------|---------|-----------|
| `sendVerificationEmail` | Admin signup | New admin user |
| `sendAcknowledgementEmail` | Admin clicks Acknowledge on a single entry | Portal user (submitter) |
| `sendBulkAcknowledgeEmail` | Admin bulk-acknowledges multiple entries | Portal user(s) grouped by email |
| `sendPortalSignupEmail` | Portal user registers | Portal user |
| `sendPortalApprovalEmail` | Admin approves portal user | Portal user |
| `sendPortalRejectionEmail` | Admin rejects portal user | Portal user |
| `sendPortalResetPasswordEmail` | Portal user requests password reset | Portal user |

> **Note:** Acknowledgement emails are sent **only** when an admin explicitly clicks Acknowledge (single or bulk) — they are NOT sent automatically on submission.

---

## Developer Settings Panel

Accessible only to users with the `developer` role at **Settings → App Settings**.

### Tabs

#### General
- App Name, Description
- Theme (light/dark), sidebar style, colors

#### Portal & Email
- Portal title/subtitle
- Toggle portal on/off
- Email configuration

#### Security
- Session timeout, max login attempts
- Default role for new users
- Maintenance mode toggle

#### System & Logs
- System info (read-only)
- Live application logs with search and filtering
- Log level filtering (info, warn, error)
- Clear logs

#### Portal Users
- Embedded portal user management
- Approve/reject registrations
- Assign SLF facilities

---

## Adding a New Module

To add a new data module (e.g., "Water Treatment"):

### 1. Create the Mongoose Model
```
server/models/WaterTreatment.js
```

### 2. Create the Express Route
```
server/routes/waterTreatment.js
```
Standard CRUD: GET (list), POST (create), PATCH (update), DELETE.

### 3. Register the Route in `server.js`
```js
const waterTreatmentRoutes = require("./routes/waterTreatment");
app.use("/api/water-treatment", waterTreatmentRoutes);
```

### 4. Create the Front-end Page
```
front-end/src/pages/admin/WaterTreatment.jsx
```

### 5. Register in AdminHome.jsx
- Add a menu item in the sidebar array.
- Add a case in the content renderer.

### 6. (Optional) Add Seed Data
```
server/seeds/seedWaterTreatment.js
```

---

## Seed Scripts

Located in `server/seeds/`. Run directly with Node:

```bash
cd server
node seeds/seedSlfFacilities.js
node seeds/seedDataReferences.js
# etc.
```

Each script connects to MongoDB, inserts/updates data, then disconnects. They are idempotent — safe to run multiple times.

---

## Coding Conventions

- **Front-end state:** No Redux/Zustand. Local `useState` + `useEffect` with polling intervals.
- **Storage:** All sensitive client-side data goes through `secureStorage` (AES-encrypted localStorage).
- **Cache:** Some admin pages cache API responses in secureStorage with TTL for faster repeat loads.
- **UI:** Ant Design exclusively. SweetAlert2 for confirmations/alerts.
- **Styles:** Module CSS (`SLFPortal.css`, `App.css`, `index.css`). Ant Design's token system for theming.
- **Error handling:** Backend routes use try/catch with JSON error responses. Frontend uses SweetAlert2 for user-facing errors.
- **Naming:** camelCase for variables/functions, PascalCase for components, kebab-case for API routes.

---

*© 2026 EMBR3 — Environmental Management Bureau Region III. All rights reserved.*
