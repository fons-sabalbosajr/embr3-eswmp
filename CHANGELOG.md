# Changelog

All notable changes to the EMBR3 ESWMP application are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(`MAJOR.MINOR.PATCH`).

## [Unreleased]

### Added
- `server/utils/dummyFilter.js` and `front-end/src/utils/excludeDummy.js` —
  reusable helpers that keep dummy/test SLF facilities and portal accounts out of
  production-facing displays, using the existing indexed `isDummy` flag.
- Reusable `front-end/src/components/GaugeMeter.jsx` — dependency-free SVG
  semicircular gauge with a `computeGaugePercent` helper (clamped 0–100, max 2
  decimals, "No capacity data available" when required values are missing).

### Added
- **Dev Portal Credential** (developer-only): a PIN-gated developer override on
  the portal login page to open a portal user's session for debugging. New
  `Developer > App Settings > Dev Portal Credential` tab (set/update PIN, email a
  regenerated PIN), backend `/api/dev-portal/*` staged flow (override → PIN →
  select → impersonate). PIN is bcrypt-hashed, validated only server-side, never
  returned/logged; lockout after 5 failed attempts; all impersonation audited.

### Changed
- Table page-size changers standardized via `withSizeChanger` helper (grouped
  entries, PVT/LGU fix, Accounts & Roles, Portal Users, Developer tables).
- Developer-only access is now enforced for **App Settings** and **Accounts &
  Roles** on both the frontend (menu + route guard) and backend — `/api/users`
  now requires `authMiddleware + developerOnly` (previously unauthenticated).
- Auth pages (Login/Signup/Forgot/Reset/Portal) tightened spacing to fit the
  viewport without scrolling; short-viewport fallback scrolls gracefully.
- PVT/LGU ID mismatch preview: in-modal error + Retry (no longer kicks the user
  out), duplicate-fetch guard, and a server-side payload cap for large sets.
- Renamed the Dashboard Main Menu tab **SLF Monitoring → General Dashboard**
  (`AdminHome.jsx`). The sidebar "SLF Monitoring" page (SLF Data Table) is
  unchanged and keeps handling records only.
- Redesigned the General Dashboard tile modals: **Cell Infrastructure** and
  **Total Capacity** now use gauge-metric charts (overall + per-SLF gauge cards)
  instead of line progress bars, per the gauge calculation rules.
- Cell Infrastructure gauge cards are now clickable, drilling into a per-cell
  card breakdown (name, status, capacity, used/remaining, utilization gauge, or
  "No capacity data available" fallback).
- Waste Received modal now charts **Portal Submissions** data (monthly waste
  volume + waste-by-type from `/data-slf/stats`).
- Portal Submissions **Summary** tab volumes now display a maximum of 2 decimal
  places via a safe `formatVolume`/`formatVolumeValue` helper.
- Portal Submissions **Submissions** tab: narrower Action/Status columns with
  button wrapping, reduced column widths, smaller header font, and a lower
  horizontal-scroll floor to fit the table without excess scrolling.
- Google Drive test connection no longer hard-requires the optional hauler-LOI
  folder (uploads only need image + document folders), and returns a clear,
  credential-free re-authentication message when the OAuth refresh token expires.
- Deduplicated the transaction-backfill logic shared by server startup and the
  `POST /api/transactions/seed` route into `server/utils/backfillTransactions.js`.

### Fixed
- Escaped the user-supplied `search` term in the logs and transactions APIs so
  special characters can no longer break the query regex (HTTP 500) or cause ReDoS.
- Dummy/test data no longer leaks into production dashboards, reports, or emails.
  Excluded dummy records from the admin dashboard stats (`/data-slf/stats`), the
  Waste Generators tiles (`/data-slf/generator-summary`), the SLF Monitoring
  dashboard stats (`/slf-facilities/stats`, incl. capacity/waste/trash-slide/
  fire-prevention/leachate tiles), and portal announcement emails. Developer
  views can still opt in with `?includeDummy=true`.
- Excluded dummy submissions and dummy accounts from the Transactions activity
  report (`GET /api/transactions` and its company filter dropdown). Transactions
  have no isDummy flag, so the report resolves the dummy submission/account set
  and hides any linked audit entry — self-maintaining, no backfill required.

## [1.4.0] — 2026-07-09

Baseline release. Consolidates the features shipped since the initial 1.0.0
scaffolding; this is the first tagged version.

### Added
- Admin-side report generation.
- Portal support-ticketing system.
- Maintenance-mode toggle.

### Changed
- Refined SLF portal UI and visuals.
- Increased file-upload limits and improved Google Drive error handling.

### Fixed
- Data-table rendering errors.
- Accredited-haulers Excel upload.

[Unreleased]: https://github.com/fons-sabalbosajr/embr3-eswmp/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/fons-sabalbosajr/embr3-eswmp/releases/tag/v1.4.0
