---
name: app-maintenance-review
description: Full app health check and improvement pass — connections/CRUD, data optimization, UI trends, user traffic, Cloudflare status, backend cleanup, and versioning. Use when the user says "run my app checkup", "do the routine", "check the app", "let's do the maintenance pass", or opens a project and asks for a general health/status review.
---

# App Maintenance & Improvement Routine

Run this as a structured pass over the currently open project. Work through each
section in order. For each section: report findings first, then propose fixes,
then apply only the ones the user confirms (unless they've said "auto-fix
everything" up front).

**Verifying applied fixes**: any time this routine applies a code change (sections
1, 5, 6), don't just apply and move on — verify it with a short fix-run-repeat
loop if the project has a test suite or build step:
1. Run the project's test/build command.
2. If it passes, move to the next section.
3. If it fails, diagnose the failure, make the smallest correcting fix, and re-run.
4. Stop the loop on success, on a repeat of the same failure two iterations
   running (misdiagnosis, not more retries, is the fix), or after **10 iterations**
   — whichever comes first. On a non-success stop, report the unresolved state
   plainly rather than leaving the change in an unverified or half-applied state.

This mirrors the `debug-loop` skill's protocol; use that skill directly instead
if the user wants a dedicated debugging session rather than a step embedded in
this routine. Never use this loop to justify skipping the user's confirmation
step for a fix — verification happens *after* a fix is approved and applied, not
as a substitute for approval.

## 0. Context gathering (do this first, silently)
- Identify the app: framework, language, package manager, entry point.
- Identify the backend: API layer, database, ORM.
- Check for a `CLAUDE.md`, `README.md`, or `.env.example` for project-specific
  conventions before assuming anything.
- Check if Cloudflare is used (wrangler.toml, CF env vars, DNS references) so
  step 4 knows whether it applies to this project.
- Identify the test/build command (e.g. `npm test`, `npm run build`, `pytest`)
  if one exists — this is what the verification loop above will use. If none
  exists, note that and skip verification loops for this run rather than
  guessing at a command.

## 1. Connections & CRUD health
- Trace CRUD operations (Create/Read/Update/Delete) through the codebase:
  API routes/controllers → service/business logic → data layer.
- Look specifically for:
  - N+1 queries, missing indexes, unbatched loops calling the DB/API.
  - Missing or overly broad error handling around network/DB calls.
  - Loading states: are they present for every async fetch/update, or do some
    UI paths silently hang or double-fire?
  - Optimistic updates vs. actual server confirmation mismatches.
- Data loading integrity & optimization:
  - Confirm no optimization pass risks data loss, stale reads, or race
    conditions (e.g. cache invalidation gaps, debounced calls that drop
    in-flight requests).
  - Look for opportunities to improve loading performance across the codebase:
    pagination/infinite scroll instead of full-table fetches, request
    batching, memoization, caching layers, lazy loading of non-critical data.
  - Only propose new optimizations if they don't compromise data accuracy or
    consistency — flag the tradeoff explicitly if one exists.
- Report as a table: `Operation | File | Issue | Suggested Fix`.
- Applied fixes here get verified per the loop described above before moving on.

## 2. UI component review vs. current design trends
- List the core reusable components (buttons, forms, cards, nav, modals).
- For each, note: does it match current UI conventions (spacing, motion,
  contrast, empty/loading/error states, responsive behavior)?
- **This step needs current information, not just training knowledge** — if
  it's been a while, use web search for "current [framework] UI design trends
  [current year]" or similar before making recommendations, since visual
  trends shift faster than a model's training cutoff.
- Flag components that are functional but visually/UX-dated, and propose
  specific, incremental changes (not a full redesign) unless asked otherwise.
- Responsiveness check:
  - Verify pages/components render correctly across breakpoints — mobile,
    tablet, laptop, and large/wide screens.
  - Check for a CSS reset/normalization layer; if inconsistent cross-browser
    default styling is causing issues, propose adding `normalize.css` (or
    confirm the existing reset is sufficient before adding another one).
  - Flag any fixed-width layouts, non-fluid units, or missing media queries.

## 3. User data traffic check
- Identify where traffic/usage is measured (analytics SDK, server logs,
  Cloudflare Analytics, APM tool).
- Summarize: request volume patterns, peak times, error rate trends, any
  endpoints with unusually high latency or failure rate.
- If no traffic monitoring exists, say so explicitly and suggest a lightweight
  option rather than assuming data is available.

## 4. Cloudflare status check
- If this project uses Cloudflare, check (via dashboard/API/CLI as available):
  - Security: WAF rules, firewall events, any active threats/blocks.
  - Traffic: request volume, cache hit ratio, bandwidth trends.
  - Cache: recommend or perform a purge if stale content is suspected
    (confirm before purging — this affects live traffic).
  - Any other relevant Cloudflare functions in active use (Workers, Page
    Rules, Access, Rate Limiting).
- If Cloudflare isn't configured for this project, skip this section and say so.

## 5. Client-side storage security
- Scan for all `localStorage` and `sessionStorage` usage across the codebase.
- For each key/value pair stored:
  - Confirm sensitive data (tokens, user info, PII, session identifiers) is
    encrypted before being written, not stored in plain text.
  - If unencrypted sensitive data is found, propose an encryption approach
    (e.g. Web Crypto API, or a vetted library) and note that the encryption
    key itself must never be stored alongside the encrypted data in the same
    storage.
  - Flag any data that shouldn't be in browser storage at all (e.g. long-lived
    secrets that belong server-side only, in httpOnly cookies).
- Report findings as: `Key | Location (file) | Currently Encrypted? | Risk | Fix`.
- Applied fixes here get verified per the loop described above before moving on.

## 6. Backend cleanup
- Identify dead code: unused functions, commented-out blocks, unreferenced
  files, deprecated endpoints still deployed.
- Identify duplicated logic that could be consolidated.
- Remove repeatable/redundant comments across the codebase:
  - Boilerplate comments that just restate what the code already says
    (e.g. `// increment i` above `i++`).
  - Copy-pasted comment blocks repeated across many files that add no
    file-specific value.
  - Keep comments that explain *why*, document non-obvious business logic,
    or are required (license headers, API docs) — only strip genuinely
    redundant/noisy ones, and show a sample diff before doing a bulk pass.
- Flag (don't silently remove) anything that's ambiguous — e.g., code that
  looks unused but might be called dynamically or by an external integration.
- Propose a cleanup diff; apply only after confirmation for anything touching
  shared/critical modules.
- Applied fixes here get verified per the loop described above before moving on.

## 7. Continuous improvement & versioning
This is the step to actively help plan, not just execute:
- Review recent changes/commits to understand what's shipped since the last pass.
- Ask the user (or infer from CHANGELOG/commits) what new features are planned
  or in progress.
- Recommend a version bump following semver (MAJOR.MINOR.PATCH) based on the
  actual nature of changes since the last tag — breaking changes vs. new
  features vs. fixes.
- Draft changelog entries in plain language.
- If there's no versioning system in place yet, propose a simple one
  (e.g., semver + CHANGELOG.md + git tags) rather than assuming one exists.

## Output format
End each full run with a short summary table:

| Area | Status | Key Issues Found | Action Taken / Recommended | Verified |
|---|---|---|---|---|
| CRUD/Connections & Data Loading | | | | |
| UI Components & Responsiveness | | | | |
| Traffic | | | | |
| Cloudflare | | | | |
| Client-Side Storage Security | | | | |
| Backend Cleanup | | | | |
| Versioning | | | | |

"Verified" is only marked for sections where fixes were applied and the
verification loop confirmed a pass; leave blank for sections with no applied
fixes, and mark "unresolved" if the loop hit its stop condition without passing.

Don't apply destructive or production-affecting changes (deploys, cache
purges, deletions) without explicit confirmation, even if earlier steps in
the same run were pre-approved.