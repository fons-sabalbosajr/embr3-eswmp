# Changelog

All notable changes to the EMBR3 ESWMP application are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(`MAJOR.MINOR.PATCH`).

## [Unreleased]

### Fixed — SLF Portal Data Entry loaded empty
- `GET /data-slf/baseline/:slfName` fetched its candidates with
  `sort({ createdAt: -1 }).limit(50)`, but an SLF's baseline lives in a
  baseline-only *container* created on the first save — the OLDEST document the
  facility owns. On a busy SLF it fell outside that window (Zambales - Iba ranked
  79th of 80; Nueva Ecija - Santa Rosa 68th of 69), so Data Entry hydrated from a
  submission carrying none of the baseline columns and every field came up blank.
  The containers are now fetched by their own query, so the recency window can
  only add fallback material, never decide the answer.
- Each baseline field is resolved across the candidate set when an SLF has NO
  container (a legacy facility whose baseline was only ever duplicated onto its
  submissions). Recovers the stored Total Volume Accepted for Limay, Porac,
  Floridablanca and Prime Waste Solution, plus a missing barangay on Baler and
  Balanga and a closed-cell entry on Porac. Where a container DOES exist it stays
  authoritative and nothing falls through, so a deleted cell entry, hauler or
  address is never resurrected from an older copy.

### Fixed — portal dashboard: the cards below the KPI row
- `GET /data-slf/waste-received-summary/:slfName` selected `accreditedHaulers` on
  every submission while using a single copy of it, and that array is duplicated
  across all of an SLF's baseline documents. It is the one request every card
  below the KPI row waits on. The hauler list is now resolved in two small passes
  (pick an id, then read that one record): measured against live data, **84–92%
  less data and ~8–12× faster** on the heavy facilities — Floridablanca 5.3 MB →
  0.8 MB, Prime Waste Solution 4.9 MB → 0.4 MB — with identical output.
- The Accredited Haulers card is gated on the baseline fetch it actually reads,
  not on the waste-received aggregation. It used to sit in a skeleton behind the
  slowest request on the page and, when that failed, report "No accredited
  haulers recorded" for a fleet already loaded.
- The dashboard's chart derivations (client identity map, hauler ranking, waste
  breakdowns, cell-status donut) are memoized. They re-ran on every render of the
  panel — thousands of string builds per render on facilities with 80–141
  accredited haulers, for data that had not moved.

## [1.5.0] — 2026-08-13

### Fixed — data integrity: baseline, submissions & cell occupancy
- Baseline data no longer disappears: `GET /data-slf/baseline/:slfName` projects the
  General Information columns it returns (`address`, `companyRegion`,
  `companyProvince`, `companyMunicipality`, `companyBarangay`) — they came back
  `undefined`, so the portal's company form initialised empty on reload.
- Accredited haulers are read from the same record set the baseline save writes to,
  so vehicle capacities and client details no longer revert on reload.
- Submission failures from "duplicate or ambiguous" haulers/clients: an SLF's
  `accreditedHaulers` array is duplicated across every baseline document, and one
  client is stored in up to three places on the same hauler. Those copies are now
  collapsed to one record per distinct entity before the relationship check.
- Baseline containers are no longer treated as submissions: a record with no
  transport entries gets no ID No., is excluded from both submission lists, the
  dashboard counts, the SLF map and the unresolved-revert block, which produced a
  phantom "SLF-…-XX-0001 · 0 · No Waste Data · Pending" row after every first save.
- Cell occupancy is recomputed at every lifecycle point (submit, resubmit, status
  change, admin cell assignment, delete/restore, bulk actions) — it previously
  refreshed only from Organize Cells, leaving 8 of 16 facilities under-reporting.
- Reverted submissions: Province/Municipality/Barangay are preserved when loading a
  record for Edit & Resubmit, the completion gate reads the form store (so an
  unmounted tab no longer reads as incomplete), and the history refetch is forced
  so a resubmitted entry shows its new status and ID No. immediately.
- Bulk upload no longer discards rows that match an existing record; a partial
  upload updates the fields it carries and leaves the rest intact. `clientAddress`
  now persists end to end.
- Preview Uploaded Data: an edited disposal cell re-resolves its canonical
  `cellIndex`, so the edited placement — not the uploaded one — is imported.
- Baseline and submission transaction histories are separated; baseline events are
  no longer filed inside a disposal submission's thread.

### Added — admin tooling
- Admin → Submissions: an **Actual / Dummy** tab, developer- and demo-gated on both
  the client and the API (a non-authorised caller gets 403, not a filtered list).
- Baseline Data: a **Baseline History** timeline per SLF, and Last Updated now shows
  date *and* time.
- Client Data Issues: server-side pagination and a status filter (the modal fetched
  all 28,547 flags at once and showed an empty table when the request died), plus
  **VERA-assisted repair** — VERA proposes a province/municipality resolved against
  the Region 3 masterlist and the admin approves it, per row or in bulk. Only
  high-confidence proposals are bulk-selectable; ambiguous ones need a human choice.
- `scripts/auditLguCoverage.js`, `scripts/clearBaselineSubmissionIds.js` and
  `scripts/generateDevTestWorkbook.js` — read-only or dry-run by default.

### Changed
- Province lists across the admin views sort alphabetically through one shared
  comparator instead of by record count.
- Demo-session value masking now honours the global privacy toggle rather than
  running unconditionally, so a demo account can complete its own workflow.
- Transport Entries in Review & Submit, and the Trucks tables, render as tables
  that fit their modal, with wrapping cells and slim scrollbars.
- Landing page: reduced-motion now stops the CSS animations too, mobile runs fewer
  moving elements, and the hero dashboard mockup animates as a working system.

### Added — VERA assistant & operational tooling (1.5.0)
- VERA (Virtual Environmental Response Assistant): role-aware chatbot for the SLF
  Portal and Admin Portal — KB-grounded answers with a rule-based fallback when no
  AI provider is configured, a "thinking" state with cancel/retry/timeout, a shared
  animated flame icon, first-login onboarding, and a dashboard VERA tips card. Role
  is enforced from the authenticated token; a restricted guard refuses developer /
  secret topics for every role. Reuses the existing Automation Agent provider layer.
- Prevention Measures: secure document summaries (PDF/DOCX/TXT via `pdf-parse` +
  `mammoth`) with source references, low-confidence warnings, size/type validation,
  per-SLF isolation, and cached/invalidated results — shown separately from the
  official narrative.
- LGU reconciliation: deterministic + province-scoped fuzzy matcher (`lguMatch`),
  admin review panel with accept/reject/manual-review, non-destructive alias
  linking, and an immutable `LguLinkAudit` trail. New endpoints
  `GET /slf-clients/lgu-reconciliation`, `POST /:id/link-lgu`,
  `POST /:id/flag-manual-review`, and `GET /slf-clients/issues/count`.
- Dedicated VERA notification bell (admin/developer) surfacing deterministic,
  sanitized findings (unlinked LGUs, data-quality, provider health) via
  `GET /vera/notifications`.

### Changed — dashboard, map & counting
- SLF Location Map markers are date-specific to the Disposal Calendar selection;
  the calendar gains month prev/next navigation and a year summary view. Marker /
  legend / status come from one shared `MAP_MARKER` config.
- Total SLF tile headlines the operational count (status-based; a non-operational
  facility that still submits is not counted) with total + non-operational
  secondary and a rule tooltip.
- LGUs-Served counting is municipality-unique (by masterlist id, cities included),
  private-sector counted separately; summary tiles sit in one equal-width row.
- Dashboard waste volumes displayed in tons via the shared `convertVolume`; the
  "Most Active Portal Users" widget is a ranked avatar list; "Waste Volume by SLF"
  shows all SLFs.
- FAQ retired in favour of VERA; support contact email centralized to
  `eswmr3@emb.gov.ph` (`config/appContact.js`, `server/config/contact.js`).

### Fixed
- Nested Daily Submission Details modal now layers above the FullCalendar popover
  and sticky header (z-index brought into the antd scale, no arbitrary escalation).
- Hauler Clients Issues badge uses an authoritative server count (`/issues/count`),
  `99+` overflow, and an accessible label; refreshes on resolve/reopen/refresh.
- Duplicate/nested focus outlines on authentication inputs consolidated to one
  accessible ring across all auth pages.
- `admin-edit` submissions now emit a live refresh so other admin tabs and the
  portal user update without a manual reload.

### Security
- Closed anonymous access to the core API. A new `requireAnyAuth` middleware
  (valid admin- or portal-realm JWT) now gates every route in `dataSLF`,
  `transactions`, `notifications`, `slfFacilities`, `supportTickets`,
  `portalQueue`, and `haulerDeleteRequests`, plus the mutating `settings`
  routes (`PUT /app`, `/fields` create/update/delete, `/org-chart`). Previously
  these were reachable with no token — including `bulk-delete`, `bulk-revert`,
  transaction edit/delete, and cross-recipient notification read/delete (IDOR).
  Read-only pre-login settings routes (`GET /app`, `/address/*`) stay public.
- Audit actor is no longer spoofable. `getRequestActor` and request logging now
  prefer the server-verified email (resolved from the JWT against the DB,
  covering both `User` and `UserPortal`) over the client-supplied `X-User-*`
  headers / `performedBy` body field.
- 5xx responses no longer leak internals. When `NODE_ENV=production`, a response
  sanitizer strips the internal `error` field from 5xx bodies app-wide (4xx
  validation detail is preserved for the UI). Document `NODE_ENV=production` in
  `.env.example`.
- Documented `JWT_SECRET` rotation (`docs/JWT_SECRET_ROTATION.md`); flagged the
  short existing secret for rotation to ≥ 32 random bytes.

### Added
- `server/utils/validate.js` — dependency-free request-body validation
  (required fields, type/range/enum checks) returning structured 400s. Applied
  to `POST /api/slf-facilities` as the reference pattern for other write routes.

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

[Unreleased]: https://github.com/fons-sabalbosajr/embr3-eswmp/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/fons-sabalbosajr/embr3-eswmp/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/fons-sabalbosajr/embr3-eswmp/releases/tag/v1.4.0
