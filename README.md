# EMBR3 ESWMP — Ecological Solid Waste Management Pipeline

A web-based **Sanitary Landfill (SLF) monitoring system** for the **Environmental Management Bureau (EMB) Region III**. It combines a public-facing **SLF Generators Portal** for disposal reporting with an **Admin dashboard** for review, monitoring, and oversight.

> Version 1.4.0

---

## Description

The Ecological Solid Waste Management Pipeline (ESWMP) centralizes how sanitary-landfill disposal activity is reported and monitored. SLF operators submit disposal records through the portal; EMB personnel review, acknowledge, or return them for correction; and dashboards, maps, and calendars keep everyone's view current in real time.

- **Non-technical overview:** [docs/SYSTEM_PROJECT_OVERVIEW.md](docs/SYSTEM_PROJECT_OVERVIEW.md)
- **Technical overview:** [docs/TECHNICAL_OVERVIEW.md](docs/TECHNICAL_OVERVIEW.md)

---

## Main Features

- SLF Portal disposal submissions with a guided data-entry workflow.
- Group submissions, drafts, and scheduled submissions.
- Admin review workflow: acknowledge, revert, and resubmit.
- Interactive SLF location mapping and a disposal activity calendar.
- Cell infrastructure monitoring (capacity, fill levels, status).
- LGU and private-sector client monitoring and relationship views.
- Portal messaging, announcements (with scheduling and email), and grouped admin notifications.
- Real-time updates across admin and portal views (Socket.IO).
- Application settings, a developer-controlled sensitive-value masking toggle, and an optional read-only Automation Agent.

---

## Screenshots

> Add screenshots here. Use images that do not contain real production data, credentials, or personal information (use sample names such as `SLF ABC` / `Company ABC`).

| View | Placeholder |
|---|---|
| Landing page | `docs/screenshots/landing.png` *(to be added)* |
| SLF Portal — Dashboard | `docs/screenshots/portal-dashboard.png` *(to be added)* |
| SLF Portal — Submission History | `docs/screenshots/portal-history.png` *(to be added)* |
| Admin — Monitoring | `docs/screenshots/admin-monitoring.png` *(to be added)* |

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 7, React Router 7 |
| UI | Ant Design 6, Recharts, Leaflet / React-Leaflet, FullCalendar, SweetAlert2 |
| Backend | Node.js, Express 5 |
| Database | MongoDB (Mongoose 9) |
| Auth | JWT (`jsonwebtoken`) + `bcryptjs` |
| Real-time | Socket.IO 4 |
| Storage | Google Drive (`googleapis`) + local fallback, Multer |
| Email | Nodemailer |
| Security | Helmet, `express-rate-limit` |
| AI (optional) | `@anthropic-ai/sdk`, `@google/genai` (Automation Agent) |

Full versions and rationale: [docs/TECHNICAL_OVERVIEW.md](docs/TECHNICAL_OVERVIEW.md#technology-stack).

---

## Project Structure

```
embr3-eswmp/
├── front-end/     # React + Vite SPA (Admin dashboard + SLF Portal)
│   └── src/       # pages/, components/, utils/, api.js, App.jsx
├── server/        # Express REST API
│   └── ...        # routes/, models/, middleware/, utils/, server.js, .env.example
├── docs/          # Documentation
├── CHANGELOG.md
└── README.md
```

---

## Requirements

- Node.js (LTS) and npm
- A reachable MongoDB instance
- (Optional) SMTP/Gmail, Google Drive, and an AI provider key for email, file storage, and the Automation Agent

---

## Installation

```bash
# Clone
git clone <your-repo-url> embr3-eswmp
cd embr3-eswmp

# Backend
cd server
npm install

# Frontend
cd ../front-end
npm install
```

---

## Environment Setup

Copy the template and fill in your own values (never commit real secrets):

```bash
cd server
cp .env.example .env
```

Required core variables (names only — see `server/.env.example` and [docs/TECHNICAL_OVERVIEW.md](docs/TECHNICAL_OVERVIEW.md#environment-variables) for the full list):

```env
PORT=
MONGODB_URI=<your-mongodb-connection-string>
JWT_SECRET=<generate-a-secure-secret>
NODE_ENV=
CLIENT_URL=http://localhost:5173/eswm-pipeline
```

> Do not commit `.env`. AI provider keys, if used, must be your own funded keys.

---

## Running Locally

Run the backend and frontend in separate terminals:

```bash
# Backend (auto-reload)
cd server
npm run dev        # or: npm start

# Frontend
cd front-end
npm run dev
```

The frontend is served under the base path `/eswm-pipeline/`. By default the Vite dev server proxies API calls to the backend.

---

## Build Instructions

```bash
cd front-end
npm run build      # outputs static assets to front-end/dist/
npm run preview    # optional: preview the production build
```

Serve `front-end/dist/` with a web server and run the backend as a Node.js process. The full deployment procedure is maintained in an internal runbook (not published in this repository).

---

## User Roles

| Role | Access |
|---|---|
| `developer` | Full access, including developer-only settings. |
| `admin` | EMB administrator: review, monitoring, records. |
| `user` | Standard admin-side account (permission-gated). |
| SLF portal user | Submits disposal data; scoped to their own facility. |

---

## Documentation

- [System Project Overview](docs/SYSTEM_PROJECT_OVERVIEW.md) — non-technical briefing.
- [Technical Overview](docs/TECHNICAL_OVERVIEW.md) — architecture, models, API, security.
- [Admin Guide](docs/ADMIN_GUIDE.md)
- [Developer Guide](docs/DEVELOPER_GUIDE.md)
- Deployment Guide — *internal document, maintained separately and not published in this repository*
- Google Drive Credential Update — *internal document, maintained separately and not published in this repository*
- JWT Secret Rotation — *internal document, maintained separately and not published in this repository*
- [Changelog](CHANGELOG.md)

---

## Security Notes

- Never commit `.env`, credential JSON files, private keys, or certificates. These are covered by `.gitignore`.
- Secrets are read from environment variables; database-stored config secrets are encrypted at rest.
- Use a strong `JWT_SECRET` and a dedicated `SECRET_ENCRYPTION_KEY` in production, and set `NODE_ENV=production`.
- If a secret is ever committed, **rotate it** — removing it from the current file does not remove it from Git history.
- Do not place real secrets, internal URLs, private contact details, or production credentials in documentation.

---

## Contribution Guidelines

- Create a feature branch off the main branch for your changes.
- Keep changes focused; do not commit secrets or `.env` files.
- Match the existing code style and conventions.
- Update relevant documentation when behavior changes.
- Open a pull request describing the change and its rationale.

---

## License

Licensed under **ISC** (see `server/package.json`). If a different license applies to this repository, replace this section accordingly. *(License placeholder — confirm with the maintainers.)*

---

## Maintainer

Maintained by the **EMB Region III — ESWMP** project team. For access, deployment, or support, contact the project maintainers through your organization's approved channels.

> Contact details are intentionally omitted from this public document. Use approved internal channels rather than personal contact information.
