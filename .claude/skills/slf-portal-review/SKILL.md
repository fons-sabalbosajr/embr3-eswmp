---
name: slf-portal-review
description: Recurring maintenance, monitoring, and improvement pass for the SLF Portal (portal-user side) of the EMBR3 ESWMP app — monitors portal users' Excel/CSV uploads and submissions, verifies submissions reflect in the SLF Dashboard capacity gauges, audits for cross-portal-user data leakage, exercises portal functions for correctness, improves the portal→admin submission pipeline, fixes broken portal-side code, upgrades the assigned-SLF dashboard from submitted data, and enforces the over-capacity / data-correction submission notes that block submission. Use only when the user asks for a review or monitoring PASS: "check the SLF Portal", "review the portal side", "monitor portal users", "check portal submissions", "is portal data leaking". Do NOT use for a specific bug fix or feature request on the portal — handle those directly.
model: sonnet
---

# SLF Portal Review & Improvement

A structured pass over the **portal-user side** of the SLF module — the interface
SLF facility operators use to submit disposal data, upload Excel/CSV, manage
baselines, and watch their own dashboard. The admin monitoring side is a
consumer of what the portal produces; this routine's job is to keep the portal
correct, isolated per user, and honest about capacity.

For each section: **report findings first, propose fixes, then apply only what
the user confirms** (unless they said "auto-fix everything" up front). Two things
are non-negotiable here and override any optimization: (1) one portal user must
never see or affect another user's / another SLF's data, and (2) a submission
that is over capacity or has a flagged correction must not silently proceed.
Never trade either of those for convenience or speed.

**Verifying fixes**: whenever this routine applies a code change, verify it with
a short fix-run-repeat loop. The repo has two package roots —
`front-end/` (Vite/React) and `server/` (Express/Mongoose). Detect the
build/test command per root (`npm run build` / `npm run lint` in front-end,
`npm start` / any test script in server); run only the test files for the code
you touched (full suite once at the end). On failure, make the smallest
correcting fix and re-run. Stop on pass, on the same failure twice, or after 3
iterations. Never leave a change applied-but-unverified. If
no command exists for a root, say so and skip its loop rather than guessing.

**Scope (read first):** run ONLY the sections the user names. With no sections
named, run 3 (data isolation) and 8 (capacity gate) — the two invariants — and
list the others as available. Run all nine only when the user asks for a "full"
review. Skip `npm audit` and live flow-driving (section 4) unless asked.

## 0. Context map (read this first — don't re-derive it)

The portal side is large (`SLFPortal/index.jsx` is ~390KB). Use this map instead
of re-exploring from scratch; confirm a symbol still exists before relying on it.

**Portal front-end** (`front-end/src/pages/SLFPortal/`)
- `index.jsx` — the whole portal: submission form, Excel/CSV upload, baseline
  editor, cell organizer, submission history, drafts/scheduled.
- `SLFPortalModals.jsx`, `DraftsScheduledPanel.jsx`, `constants.js`, `SLFPortal.css`.
- `../PortalLogin.jsx`, `../PortalSignup.jsx`, `../PortalVerificationUpdate.jsx`,
  `../PortalForgotPassword.jsx`, `../PortalResetPassword.jsx` — auth surface.

**Admin monitoring (consumers of portal data)** (`front-end/src/pages/admin/`)
- `PortalUsers.jsx` — approve/block users, assign SLF, **Manage Access**
  (`portalAccess`), maintenance mode.
- `slf-monitoring/SlfDashboardTab.jsx`, `slf-monitoring/PortalGenerators.jsx`,
  `slf-monitoring/WasteBaselineInfo.jsx`, `slf-monitoring/helpers.jsx`.
- `SLFMonitoring.jsx`, `SubmissionSummary.jsx`, `SubmissionSettings.jsx`,
  `SlfSubmissionReport.jsx`, `CellWastePlacement.jsx`.
- `../../components/GaugeMeter.jsx` — the capacity gauge.

**Server routes** (`server/routes/`)
- `dataSLF.js` — submissions (`submitEntries`, `POST /data-slf`), baseline,
  waste-received summary, admin capacity remarks, `POST /cell-capacity-alert`.
- `portalAuth.js` — portal JWT auth (`getPortalUserFromToken`), signup/verify.
- `portalUsers.js` — admin management of portal accounts.
- `portalQueue.js` — drafts & scheduled auto-submissions.
- `slfFacilities.js` — SLF facility + cell infrastructure (capacity source).
- `slfDataFiles.js`, `upload.js`, `transactions.js`, `logs.js`, `settings.js`.

**Models** (`server/models/`)
- `UserPortal.js` — portal account. Key fields: `email` (the portal identity),
  `assignedSlf[]` / `assignedSlfName[]` (scope), `portalAccess`
  (`canSubmitDisposal`, `canEditBaseline`, `canUploadExcel`, `allowedCells[]`),
  `blocked`, `maintenanceMode`, `isDummy`.
- `DataSLF.js` — the submission (single source of truth). `submittedBy` = portal
  user email, `slfGenerator` → SlfFacility, `status`
  (pending/acknowledged/rejected/revert_requested/reverted), `hiddenFromPortal`,
  `isDummy`, denormalized metrics via `computeSlfMetrics()`.
- `SlfFacility.js` — capacity source of truth: `cellCapacities[]`,
  `cellFillValues[]`, `cellStatuses[]`, `cellSubmissionAllowed[]`, `cellNames[]`,
  `volumeCapacity`.
- `PortalSubmissionQueue.js` — draft/scheduled entries (`portalUserEmail`,
  `payload`, `resultSubmissionId`).
- `AppSettings.js` — `truckCapacityAllowancePercent` (capacity allowance).

## 1. Portal user upload & submission monitoring

Goal: an accurate picture of who is uploading/submitting, when, and what
failed — the portal's operational pulse.

- Identify where portal actions are logged (`server/utils/logger.js` →
  `writeLog`, `AppLog` model, and `server/routes/logs.js`). Confirm every portal
  action that matters is logged with the actor email: Excel upload, submission,
  draft/scheduled create, baseline edit/request, revert response.
- Excel/CSV path: `handleExcelUpload` (`index.jsx` ~3231) parses client-side via
  `xlsx` (SheetJS) and is gated by `portalUser.portalAccess.canUploadExcel`
  (~3476). Row validation (`validateUploadRow` ~522) rejects non-positive
  truck/vehicle capacities. Check that upload **failures** (bad rows, disabled
  access, parse errors) are surfaced to the user *and* logged, not swallowed.
- Summarize per portal user / per assigned SLF: uploads, successful submissions,
  failures, and last-active. If there is no monitoring surface for this on the
  admin side, that's a finding — propose a lightweight view (or extend
  `SlfDashboardTab` / `PortalGenerators`) rather than assuming data exists.

## 2. Does the submission reflect in their SLF Dashboard capacity?

A submission is only "done" if the operator sees it move their gauges. Trace it
end to end for a real assigned SLF:

- Submit (or find a recent `DataSLF` for the SLF) → confirm the disposal volume
  is attributed to the correct cell (`trucks[].cellName` / `vehicles[].cellName`)
  and rolls into `cellFillValues[]` on the `SlfFacility`.
- `GaugeMeter` / dashboard fill % must derive from `cellFillValues[i]` vs
  `cellCapacities[i]` (see `activeCellOptions`, `index.jsx` ~1253:
  `isFull = capacity > 0 && fill >= capacity`). Verify the number the operator
  sees matches the sum of their acknowledged submissions.
- Watch for the classic gaps: submission saved but `cellFillValues` never
  recomputed; metrics denormalized on `DataSLF` (`computeSlfMetrics`) but the
  facility fill not updated; pending vs acknowledged counted inconsistently
  between portal and admin. Report any mismatch with the specific record + field.

## 3. Data isolation — no leakage between portal users

This is the highest-stakes section. The portal identity is **email** (from the
JWT in `portalAuth.js`); scope is `UserPortal.assignedSlf[]` /
`assignedSlfName[]`. A leak is any portal-facing endpoint that returns or mutates
another user's or another SLF's data.

- Enumerate every portal-called endpoint (grep `index.jsx` for `api.get` /
  `api.post` / `api.patch` to `/data-slf...`, baseline, waste-received-summary,
  transactions, queue). For each, confirm the **server** filters by the
  authenticated portal user — by `submittedBy = req` user's email and/or the
  user's `assignedSlf` — and does not trust a client-supplied email/SLF id as the
  only scope. Client-side filtering is not isolation.
- Verify object-level authorization on mutations: editing/reverting/deleting a
  `DataSLF` or baseline must check the record belongs to the caller's email /
  assigned SLF (guard against IDOR — changing an `_id` in the request).
- `hiddenFromPortal` correctly hides a record from the *submitting* portal user
  while keeping it visible to admin — confirm it's never used as the *only*
  access control (it hides, it doesn't authorize).
- Dummy isolation: `isDummy` records/users must not bleed into another real
  user's view. Report each leak as `Endpoint | File:line | What leaks | Fix`.

## 4. Function correctness — exercise the flows

Don't just read the code; drive the actual portal flows and observe behavior
(use the `verify` skill / preview server where practical):

- Submit disposal (single + multi-truck/vehicle), save as draft, schedule,
  resubmit a reverted entry, edit baseline + request baseline update, upload
  Excel/CSV, organize past waste into cells (cell organizer).
- Confirm gated actions honor their flags: `canSubmitDisposal`, `canEditBaseline`,
  `canUploadExcel`, `allowedCells`, and account state (`blocked`,
  `maintenanceMode`). A disabled capability must block cleanly with a clear
  message, server-side too — not just a hidden button.
- Confirm the 24h unresolved-revert block (`unresolvedRevert`, `index.jsx`
  ~4109; server `assertNoUnresolvedRevert`) actually prevents new submissions.
- Report each broken/misbehaving function as `Flow | File:line | Symptom | Fix`.

## 5. Improve the portal → admin submission pipeline

The path is `POST /data-slf` → `submitEntries` (`dataSLF.js` ~637) →
`ensurePortalAccountCanSubmit` → save `DataSLF` → notify admin. Strengthen it
without changing the DataSLF single-source-of-truth contract:

- Every write must surface a real error on failure (never optimistic success
  while the server 4xx/5xx'd); confirm `await` correctness and that the response
  reflects a committed row.
- Server-side validation must not rely on the front-end alone — re-check
  required fields, volume/capacity coercion (`coerceVolume`), company type, and
  cell assignment on the server.
- Admin gets timely, correct signal: notification + `AppLog` entry per submission
  with the right actor and counts. Batched submissions should be atomic or report
  partial failure clearly.
- Propose concrete improvements (idempotency on retry, clearer failure reasons in
  `PortalSubmissionQueue.failureReason`, dedupe of scheduled auto-submit) with
  the tradeoff stated.

## 6. Fix broken portal-side code

- Trace portal handlers for functions that error, return the wrong shape, hang,
  or are defined-but-unreachable. Prefer the smallest fix that matches
  surrounding style.
- Because `index.jsx` is huge, locate by symbol (grep) rather than reading whole;
  keep edits local and re-verify the specific flow you touched (section 4).
- Anything ambiguous (looks unused but may be called dynamically, or shared with
  admin) — flag, don't silently remove.

## 7. Upgrade the assigned-SLF dashboard from submitted data

Improve what the operator sees, driven by the data their SLF actually submits:

- Surface trends that exist in `DataSLF` but aren't shown: fill-rate over time,
  projected days-to-full per cell, residual vs hazardous split, remaining
  capacity, last-submission recency, over-capacity incidents.
- Reuse `GaugeMeter` and existing metric helpers; keep numbers consistent with
  section 2 (same fill source, same pending/acknowledged rule) so the dashboard
  never disagrees with the submission history.
- For visual/layout changes, the `dashboard-upgrade` skill is the right tool —
  hand off to it for a full redesign; here, prefer targeted, data-driven
  additions. Confirm with the user before restructuring their dashboard.

## 8. Submission notes: over-capacity & corrections (crucial — this blocks submitting)

The capacity gate is the reason submissions stop. Keep it correct, visible, and
never bypassable.

- **Allowance**: `truckCapacityAllowancePercent` in `AppSettings` (default 10%),
  read on the portal as `capacityAllowancePct` (`index.jsx` ~1330).
- **Evaluation**: `evaluateCapacity(actualVolume, actualVolumeUnit, capacity,
  capacityUnit)` (~1338) → `{ hasCapacity, exceeded, maxAllowed }`,
  `maxAllowed = cap + cap * pct / 100`, units normalized before comparing.
- **The block**: `exceeded` sets a truck/vehicle validation error in
  `validateTruck` (~2040) and produces `capacityMessages` with `ok:false` in the
  submission-level check (~4087). When not ok, the submission must **not**
  proceed — verify there is no path (draft→submit, scheduled auto-submit,
  resubmit) that skips this gate.
- **Cell-full block**: a cell with `cellFillValues[i] >= cellCapacities[i]` is
  dropped from `activeCellOptions` (~1268) so waste can't be placed into a full
  cell even if the cell is still "Active". Honor `cellSubmissionAllowed[]`,
  `cellStatuses[]`, and per-user `allowedCells`.
- **Notes to the user**: over-capacity and data-correction cases must give a
  clear, specific message (which truck/vehicle, the actual vs the max, the
  allowance %, or which cell is full) — not a generic "cannot submit". Where the
  admin needs awareness, the server computes remarks ("Exceeded truck capacity",
  "No truck capacity" in `dataSLF.js` ~336) and `POST /cell-capacity-alert`
  (~1933) notifies users of a cell nearing capacity. If a note is vague, missing,
  or a block is bypassable, that's a top-priority finding.

## 9. Security & other improvements

- **AuthN/AuthZ**: every portal route verifies the JWT and re-derives the user
  server-side; no route trusts a client-sent email/id as authorization. Rate-limit
  auth and submission endpoints.
- **Account controls**: `blocked` / `maintenanceMode` / `verificationRequired`
  are enforced server-side on every sensitive action, not just hidden in UI.
- **Client storage**: scan portal `localStorage`/`sessionStorage` for the portal
  token / user object — flag plaintext sensitive data (mirror the
  `app-maintenance-review` storage check).
- **Input & files**: server-side validation on all portal input; Excel/CSV and
  verification-file uploads size/type-checked; no injection via
  string-built queries.
- **Logging hygiene**: log security-relevant events (auth failure, authz denial,
  blocked-account attempts) but never log passwords, tokens, or full PII.
- **Dependencies**: run `npm audit` in `front-end/` and `server/`; flag
  vulnerable/abandoned packages on portal paths.

## Output format

End a full run with a summary table:

| Area | Status | Key Issues Found | Action Taken / Recommended | Verified |
|---|---|---|---|---|
| 1. Upload/Submission Monitoring | | | | |
| 2. Dashboard Capacity Reflection | | | | |
| 3. Data Isolation (leakage) | | | | |
| 4. Function Correctness | | | | |
| 5. Submission→Admin Pipeline | | | | |
| 6. Broken Portal Code | | | | |
| 7. Dashboard Improvements | | | | |
| 8. Over-Capacity / Correction Notes | | | | |
| 9. Security & Other | | | | |

"Verified" is marked only where a fix was applied and the verify loop passed;
blank where no fix was applied; "unresolved" where the loop stopped without
passing. Rank data-isolation (3) and capacity-block (8) findings above cosmetic
ones — those are the two invariants that protect data and reporting integrity.

## Guardrails

- Never weaken or add a bypass to the over-capacity block or the cell-full block
  to "make submission work" — if the user is over capacity, that is the system
  working as designed. Fix the message, not the gate.
- Never remove or loosen per-user scoping (`submittedBy` / `assignedSlf` filters)
  for convenience; a broadened query is a data leak.
- Don't apply destructive or production-affecting changes (dropping data,
  deleting portal endpoints, editing live `SlfFacility` capacities, dependency
  upgrades on a deploy) without explicit confirmation.
- Preserve the DataSLF single-source-of-truth contract — the queue and portal
  views derive from it; don't create a second source of submission state.
