# Changelog

All notable changes to the EMBR3 ESWMP application are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(`MAJOR.MINOR.PATCH`).

## [Unreleased]

### Fixed — "Submission Failed" for a submission that had in fact been saved
Traced in production logs: a portal submit answered ~2 minutes after the browser
had given up (`timeout exceeded` / `Network Error` on the client, then
`submission.create` on the server). The record was saved and reached Admin; the
operator was told it failed.
- **The post-save occupancy recompute no longer holds the response.** It re-reads
  every live record of the facility with its trucks (~1.3 MB for the largest) on
  every submit, sat between `doc.save()` and the reply with no deadline, and was
  outside the stage timings — so it never showed up as slow. The reply now waits
  at most `SUBMIT_OCCUPANCY_BUDGET_MS` (8 s) for it; past that the recompute
  finishes in the background (it emits the facility refresh itself) and the
  deferral is logged as `submission.occupancy.deferred`. `doc.save()` and the
  recompute are now timed stages (`persist`, `occupancy-refresh`).
- **A retry while the original is still running is refused, not saved twice.**
  The stored idempotency key only recognises a retry once the first attempt has
  been persisted; a retry during processing found nothing and would have created a
  duplicate. Keys in flight are tracked per process and answered
  `409 SUBMISSION_IN_PROGRESS`; the Portal shows it as "Still Processing" and
  keeps the key so the next retry resolves to the saved record.

### Changed — the Organize Cells gate no longer ships the account's every truck
The pre-submit gate was the single largest cost of every submission — 3 to 8 s on
the heavier accounts, 40 of the 46 slow-stage records in a month — because it
transferred a trimmed copy of every truck the account had ever filed to decide,
almost always, that nothing blocked. The server now reports per record only the
facts the rule can turn on (referenced cell indexes, missing capacity); the
unchanged rule is applied to those, and trucks are read only for the records it
implicates. `scripts/verifyOrganizeGateParity.js` runs the full read beside the
two-pass one on live data: identical blocker sets for all 20 accounts, with the
gate dropping from 7.2 s → 0.3 s (PWS), 5.1 s → 0.3 s, 5.2 s → 0.25 s.

### Added — portal users can produce their own disposal report
- EMB admins have had a report of every facility since day one; an operator had no
  way to produce one for their own. **Submission History → Generate Report** now
  builds a full document: facility and permits, submission status, monthly
  disposal, cell capacity and remaining space, and waste broken down by type,
  hauler, client and cell — with a date-range filter, print/save-as-PDF, and a
  `.doc` export.
- **Scope is a property of the query, not a check.** `GET /portal-auth/my-report`
  resolves the caller through `resolvePortalContext` (which refuses and audits any
  attempt to name another user) and filters on that resolved email. The endpoint
  accepts no facility or user selector, and the modal takes no identity props —
  so it cannot be pointed at another operator's data. The document also PRINTS its
  own scope, so a paper copy says whose submissions it covers.
- Aggregation happens server-side, so the browser receives a summary rather than
  every transport row.

### Fixed — report volumes that did not add up
Two defects found by running the new report against live data:
- **Per-hauler/client/cell figures were summed from raw `actualVolume` without
  normalising units.** A facility recording m³ had its breakdowns overstated
  against a tons header: Limay showed 5,045 t of haulers under a stated total of
  1,464 t. A report whose parts exceed its whole is worse than no report.
- **The header totals trusted the denormalized `totalVolumeTons`, which is 0 on
  records written before both units were populated in lockstep** (live example:
  `SLF-LGU-BA-0100` stores 188.16 m³ and 0 tons). Summing that field understated
  those facilities by more than half.
- Both are fixed the same way: every figure — totals, monthly, and all four
  breakdowns — is now derived from ONE per-vehicle walk, normalised through the
  same `TON_PER_M3` and `isHazardousWasteType` the model itself uses. The parts sum
  to the whole by construction rather than by two independent sums happening to
  agree. Verified across four facilities: byHauler, byWasteType, monthly and
  residual+hazardous all reconcile to the header exactly.

### Changed — the report states ONE current announcement
- The Generate PDF Report listed up to six announcements, which reads as history
  rather than as the notice in force. It now presents the single current one.
- The on-screen report and the `.docx` export select it through the SAME
  function. They are required to agree and had already drifted apart here once
  (the export dropped live announcements entirely while the report showed them),
  so there is now one selector and one call site feeding both.
- Selection delegates to `resolveAnnouncementStatus` rather than re-deriving
  `enabled`, ranking active → scheduled → unpublished → draft → expired and, within
  a rank, most recent first. An expired notice appears only when there is nothing
  else at all. That module owns the lifecycle; duplicating the rule is how the
  report would end up calling something "active" that the announcements console
  does not.
- The pure lifecycle rules moved to `utils/announcementLifecycle.js` so the test
  suite (plain Node, which cannot load JSX) can import them; `announcementStatus.jsx`
  keeps only the antd tag/icon presentation.

### Added — hide the data of non-operational SLFs
- A facility marked non-operational can now have its records hidden across the
  app: every Portal Submissions tab (baseline data, submissions, summaries,
  reports, cell placements) and the dashboards reading them. Controlled from
  **App Settings → Data Maintenance → Non-Operational SLFs**, which lists each
  non-operational facility with how many records hiding it would remove, and
  offers a per-facility **Keep visible** override for a closed site still under
  review.
- Applied as a Mongoose plugin on DataSLF rather than a filter per endpoint —
  Portal Submissions is seven tabs over a dozen queries, and a hiding rule that is
  forgotten on one of them fails SILENTLY, because the symptom is data appearing,
  which looks like normal behaviour. Mirrors `utils/yearVisibility` throughout,
  including composing with `.and([filter])` rather than `.where()` (the filter is
  a top-level `$or`, and Mongoose merges `$or` arrays — `.where()` would turn the
  restriction into an alternative and match almost everything).
- The filter carries **ObjectIds, not strings**: `find` casts for a typed path but
  `aggregate` does not, so a string-based filter would have hidden correctly on
  every `find` and hidden nothing in every aggregation — and most of Portal
  Submissions reads through aggregations.
- Two deliberate exclusions. The **facility record itself** stays visible in SLF
  Monitoring, which is where its status is set — hiding it there would remove the
  only way to mark it operational again. And the settings screen reads through
  `bypassSlfVisibility`, so switching the rule on cannot hide the list of what it
  is hiding.
- **Defaults OFF**, and verified a true no-op while off against live data
  (733 records, filtered and bypassed counts identical). Note it also applies to
  the SLF Portal: an operator assigned to a hidden facility will not see that
  facility's own history, which is what the per-facility override is for.

## [1.6.0] — 2026-08-25

### Fixed — one facility listed twice in Portal Submissions → Baseline Data
- `DataSLF.slfName` is a SNAPSHOT of the facility's display name at write time,
  so a rename leaves the older spelling behind and a list grouped by name shows
  one site twice. Confirmed against live data: Floridablanca Enviro Park had 58
  records under "Pampanga - Floridablanca Enviro Park Sanitary Landfill (Cat 4)
  (Private)" and 1 under "Floridablanca Enviro Park - Category 4 Sanitary Landfill
  (Private)" — the SAME facility id on both.
- Baseline rows are now collapsed on that id, which makes the merge EXACT rather
  than heuristic: two distinct facilities cannot be fused by it. The surviving row
  carries the facility's current name, keeps the most complete baseline, and
  UNIONS the update-request/approval flags so a request recorded against the older
  spelling is not hidden. The absorbed spellings show as an "older names" tag
  rather than disappearing.

### Fixed — a disposal cell had to be chosen again for waste already placed
- An entry placed as a whole — through Assign to Cell, an upload, or its own cell
  field — still demanded a cell per vehicle, and the editor carried the entry's
  cell onto only the FIRST vehicle.
- Every vehicle without a cell of its own now inherits the entry's, and the
  requirement is lifted accordingly. The inheritance is real, not a relaxed check:
  EMB's side reads placement from each vehicle and ignores the entry-level cell
  when vehicles are present, so a vehicle left without one was counted as unplaced
  waste and sent the operator to Organize Cells for an entry they had already
  placed. A vehicle's own placement always wins over the inherited one.

### Fixed — VERA turned away questions it had answers for
- `PORTAL_SCOPE_TERMS` decides whether a question reads as a portal question at
  all, before retrieval is consulted, and it had no entry for **client** — so
  "which of my clients have no address?" only stayed in scope when retrieval
  happened to rescue it, and "my client is inside Clark Freeport Zone" was refused
  outright. Client, address, province, municipality, zone/freeport and the
  encoding vocabulary are now in scope.
- New knowledge entries: client name mismatches, the upload preview's Match and
  Validation columns, and when a disposal cell no longer has to be chosen.

### Added — feature tour for this release
- The versioned one-time tour now covers the Complete Baseline Records editor,
  special economic zones, system-generated disposal files, name mismatches, the
  redesigned preview grid, and cell-placement inheritance. Steps span both Data
  Entry tabs and switch tabs before anchoring, since the tabs render lazily.
- **Dismissal is now distinct from opting out.** Closing the tour (X, Esc,
  clicking away) closes it for now and it may return next sign-in — dismissing
  something mid-task is not a decision never to see it. Two acts record the
  release as seen: finishing the last step, and an explicit **"Don't show this
  again"** offered on EVERY step. What's New reopens it on demand either way.

### Added — Complete Baseline Records, one editor for every gap
- The incomplete-records warning in Data Entry listed what was missing and then
  sent the operator to the Accredited Haulers tab to find each record by hand:
  open the hauler, find the client inside it, fill one field, close, repeat. With
  a fleet of eighty haulers that is why the gaps never closed. It now opens an
  editor holding every incomplete record — hauler office addresses and client
  type / province / municipality / address — completed in one pass and applied
  together.
- Province is a searchable nationwide list fetched ONCE for the whole modal (new
  `GET /settings/address/provinces`, one cached call instead of walking 17
  regions), with municipalities loaded per province on demand and reused for the
  life of the modal. Special economic zones and the province-less region buckets
  are included, so a client in Clark Freeport Zone or Metro Manila is selectable
  here too.
- Same contract as every other import in the portal: it writes into the hauler
  DRAFT (Save Baseline Update still persists it), a blank field keeps what is
  stored, and nothing can be removed. A hauler with no clients is sent to the
  hauler's own client editor instead of being shown fields that cannot help it.

### Added — client name mismatches are told apart from missing records
- A disposal upload reported "Hauler X is accredited, but Y is not one of its
  clients" for a client the baseline already had under a different spelling —
  "GREEN RESCUE - MUNICIPALITY OF PULILAN" against the file's "GREEN RESCUE -
  MUNICIPALITY OF PULILAN, BULACAN". Following that advice would have added a
  duplicate and split that client's volumes across two records.
- Such rows are now classified as a **mismatch** rather than a missing record, and
  the preview offers the two honest resolutions: point the file's rows at the
  stored spelling (this import only), or correct the client on the hauler — rename
  it, keeping its type, province and municipality, or add it as genuinely new. One
  decision settles every row carrying that pair. Nothing is applied automatically.
- Matching is CONTAINMENT, not a similarity score. "Municipality of Nowhere,
  Bulacan" and "Municipality of Pulilan, Bulacan" are ~85% identical as strings and
  are two different LGUs, so any threshold loose enough to catch a real mismatch
  also proposes attributing a trip to the wrong municipality. A candidate must be
  the other name plus a qualifier, or share every word with it (an abbreviation
  may prefix-match the word it shortens), and must be at least two words and 40%
  of the longer name — so "ABC" no longer matches "ABC Manufacturing Corporation".
- Against the reported file this turns 5 blocked rows into 2 decisions while
  leaving the 3 genuinely missing records listed separately. VERA is given both
  lists and asked to keep them apart, warning that re-adding a mismatched client
  creates a duplicate.
- An inline preview edit now re-runs ALIGNMENT as well as the relationship check.
  It only re-ran the latter, so a row corrected by hand kept an `_alignment`
  describing the value it no longer held, and a row fixed through a suggestion
  could never clear.

### Changed — Preview Uploaded Data: Validation column widened
- 260 → 380px. It is the only column holding sentences rather than values — the
  relationship and alignment messages name a hauler, a client and the fix — and at
  the old width they wrapped into a tall, thin ribbon harder to read than the
  error it described.

### Fixed — NCR had no provinces to pick, and 19 LGUs were unreachable
- The address cascade assumed every city sits under a province. PSGC does not
  work that way: **NCR has no provinces at all** — its 17 cities hang off four
  legislative *districts*, a different level of the hierarchy — so
  `/regions/130000000/provinces/` returned an empty array, the Province dropdown
  came up blank, and the cascade dead-ended on a required field. No client or
  facility in Metro Manila could be encoded.
- Two further regions had a single province-less city that was likewise
  unreachable: **City of Isabela** (Zamboanga Peninsula) and **City of Cotabato**
  (SOCCSKSARGEN). Both exist in their region's city list but in none of its
  provinces'.
- A region whose city list contains province-less LGUs now gains one synthetic
  province-level option covering exactly those. Where the region has no provinces
  it is named after the region ("National Capital Region"); where it has provinces
  plus strays it is labelled "… — independent cities" so it is not mistaken for a
  province that was missed. The condition is DETECTED per region, never hardcoded
  — PSGC reassigns LGUs between regions, so a hardcoded exception list would go
  stale silently.
- Verified against the live API across all 17 regions: **1,634 of 1,634 LGUs are
  now reachable** through the cascade, up from 1,615. Nothing else moved — the 14
  regions with no gap return exactly what PSGC gives, and highly urbanized cities
  already listed under their province (Angeles City under Pampanga, Olongapo City
  under Zambales) are untouched. The bucket's members keep their real PSGC codes,
  so barangays resolve normally beneath them.

### Added — special economic zones are encodable as a client's City/Municipality
- Freeports and special economic zones now appear in the client address picker
  under their host province, labelled and listed alongside the province's
  municipalities. They are absent from PSGC by construction — Clark Freeport Zone
  straddles Angeles City, Mabalacat and Porac in Pampanga plus Bamban and Capas in
  Tarlac and is administered by a zone authority rather than by any of them — so a
  client inside one could previously only be encoded against a neighbouring
  municipality (wrong) or left blank (reported as incomplete). Clark Freeport
  Zone, Clark Special Economic Zone, New Clark City, Subic Bay Freeport Zone, the
  Freeport Area of Bataan, Bataan Economic Zone and APECO ship as built-ins, with
  the major zones outside Region III; `server/utils/specialZones` is the single
  source. A zone spanning two provinces is offered under both.
- `utils/lguMatch` resolves zones through the same exact → alias → fuzzy rules and
  confidence levels as a municipality, including the abbreviations operators type
  (CFZ, SBFZ, AFAB, APECO). The never-across-provinces rule is unchanged.
- Region 3 LGU Data accepts an lguType of "Special Zone", so EMB can encode any
  zone the built-ins miss; an encoded entry overrides the built-in of the same
  name. Served-LGU counts deliberately still exclude zones — a freeport is a valid
  address but not a local government unit.
- The client address cascade now goes through the server's cached PSGC proxy
  instead of calling `psgc.gitlab.io` from the browser, which bypassed the
  24-hour cache and could only ever return political subdivisions.

### Added — system-generated disposal files are recognised and aligned
- A disposal file exported from a facility's own weighbridge / gate system records
  ONE party per trip and writes it into both the Hauler and the Client column, so
  every row failed with "Hauler … is not assigned under this SLF" — true, and
  useless, since the hauler *is* assigned. Uploads are now resolved against the
  baseline before validation: a combined "HAULER - CLIENT" value is split, and a
  value that is only a client name resolves through the single hauler serving it.
  Matched rows are rewritten to the baseline's own spelling (so the server's
  submit-time check passes too) and tagged in a new **Match** column showing what
  the file said and what it was read as.
- Nothing is guessed. Where two readings are possible the row stays blocked, and
  where a record is genuinely missing the preview lists the hauler/client names to
  encode with the number of trips waiting on each — one item of work per name, not
  one per row. Against the Prime Waste Solution export this turns 15 identical
  errors into 6 auto-matched rows and a two-line work list.
- Trailing rows holding nothing but a stray value (no date, ticket, plate, cell,
  waste type or volume) are left out of the preview and reported as skipped,
  instead of arriving in the missing-clients list as bare numbers.
- VERA now assesses disposal uploads, not only hauler uploads, and does so on a
  FAILING preview — it is given what was aligned and what was not, so the answer
  is the list of baseline records to encode rather than a restatement of the
  errors.

### Fixed — hauler and client records with no address were invisible
- The accredited-hauler table had no Office Address column at all. It now has one,
  and a hauler without an address says "Not encoded" and opens the editor. Office
  Address is an optional upload column whose blank cells mean "keep what is
  stored", so a baseline re-upload never filled it in and nothing reported it.
- The incomplete-records warning covers the HAULER as well as its clients — no
  office address, no vehicle, and no clients (which is what makes every one of
  that hauler's disposal rows unimportable). Required gaps (type, province,
  municipality) are separated from recommended ones (addresses). The rule lives in
  one module shared by the panel and the table.
- The Client Address column names how many of a hauler's clients have no address
  instead of silently omitting them, and no longer prints a raw PSGC code where a
  municipality belongs.
- VERA's portal facts include baseline completeness for the caller's own facility
  and NAME the records, so "which of my haulers have no address?" is answerable.

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
