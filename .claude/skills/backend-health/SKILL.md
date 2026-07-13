---
name: backend-health
description: Backend health, security, and optimization pass for an app — checks data-loading traffic, finds broken/slow API endpoints and heavy data loads and repairs them, audits API security and wires backend logging through to front-end app logs, verifies the database is actually persisting data submitted from the front-end, checks backend data validation, audits plugin/dependency security, and applies other backend optimizations. Use whenever the user says "check my backend", "run a backend review", "audit the API", "check backend security", "why isn't data saving", "check backend performance", "optimize the backend", or asks about API health, database writes, backend logging, validation, or backend/plugin security.
---

# Backend Health, Security & Optimization

A structured pass over the app's backend — API layer, database, validation,
logging, and dependencies. For each section: report findings first, propose
fixes, then apply only what the user confirms (unless they've said "auto-fix
everything" up front). Bold on optimization, careful with data: never trade
correctness or data integrity for speed.

**Verifying fixes**: any time this routine applies a change, verify it with a
short fix-run-repeat loop if the project has a test/build command — run it, and
on failure diagnose, make the smallest correcting fix, and re-run; stop on pass,
on the same failure repeating twice, or after ~10 iterations (same protocol as
the `debug-loop` skill). Never leave a change applied-but-unverified.

## 0. Context gathering (do this first)
- Identify the backend stack: language, framework, API style (REST/GraphQL/RPC),
  the database and ORM/query layer, and the runtime/host.
- Locate the API surface: route/controller definitions, and how requests flow
  route → business logic → data layer.
- Check for `CLAUDE.md`, `README.md`, `.env.example` for project conventions
  and required env vars before assuming anything.
- Identify the test/build command for the verify loop; if none exists, note it
  and skip verification loops rather than guessing a command.

## 1. Data-loading traffic within the app
- Find where backend traffic is observable: server logs, request middleware,
  APM tool, Cloudflare Analytics, or DB query logs.
- Summarize the picture: request volume per endpoint, peak windows, error-rate
  trends, and which endpoints carry the heaviest load or highest latency.
- Map the hot paths — the few endpoints that account for most traffic. These
  are where optimization pays off; focus effort there, not on cold endpoints.
- If there's no traffic visibility at all, say so and propose a lightweight way
  to get it (request-timing middleware, structured access logs) rather than
  assuming data exists.

## 2. Broken endpoints, bottlenecks & heavy data loads
- **Non-working functions**: trace each endpoint/handler for functions that
  error, return wrong shapes, hang, or are defined-but-unreachable (dead routes).
  Test the actual request/response where possible, don't just read the code.
- **Bottlenecks**: look for N+1 queries, missing DB indexes on filtered/joined
  columns, synchronous work that blocks the request thread, unbatched loops
  hitting the DB/external APIs, missing connection pooling, and absent caching
  on expensive read paths.
- **Heavy data loads**: find endpoints returning full tables where pagination,
  cursoring, field selection, or filtering should apply; oversized payloads;
  and repeated fetches of data that could be cached or batched.
- Repair: for each finding, propose the fix (add index, batch the query,
  paginate, cache, fix the handler) with the tradeoff stated. Apply on
  confirmation, then run the verify loop.
- Report as a table: `Endpoint | File | Issue (broken / bottleneck / heavy) | Fix`.

## 3. API security + backend→front-end logging
Two parts here:
- **Security audit** of the backend APIs:
  - AuthN/AuthZ: every non-public endpoint enforces authentication and checks
    the caller is authorized for *that specific resource* (guard against IDOR /
    broken object-level auth), not merely logged in.
  - Input handling at the boundary: parameterized queries (no string-built SQL),
    output encoding, no reflected/stored injection paths.
  - Secrets: no hardcoded keys/passwords/tokens in code; they come from env/
    secret store. Flag any found and treat as needing rotation, not just removal.
  - Transport & headers: HTTPS enforced, sensible CORS (not `*` on
    credentialed endpoints), rate limiting on abuse-prone routes.
  - Error responses don't leak stack traces, SQL, or internal paths to clients.
- **Logging pipeline**: establish/verify structured backend logging (request id,
  endpoint, user/actor, status, latency, error) and surface the relevant
  events into the **front-end app's logs** so issues are visible from the app
  side, not just buried server-side.
  - Log security-relevant events (auth failures, authz denials, validation
    rejections, unexpected 5xx).
  - **Never log secrets, raw credentials, tokens, or full PII** — redact before
    writing. Flag any existing log line that does.
  - Give front-end-surfaced logs a safe shape: enough to diagnose (error code,
    correlation id, timestamp) without exposing internals or sensitive data to
    the client.

## 4. Database write integrity (data not saving from front-end)
This is the "why isn't my data saving" check — trace a front-end submission all
the way to a persisted row:
- Follow the path: front-end request → API handler → validation → ORM/query →
  DB. Find where a write can be silently dropped.
- Common culprits to check explicitly: transaction opened but never committed;
  errors swallowed by a broad try/catch so the write fails silently; validation
  rejecting the payload without surfacing why; ORM `save()`/`create()` returned
  value ignored; unique/FK/NOT NULL constraint violations caught and hidden;
  optimistic UI showing success while the server 4xx/5xx'd; wrong/missing
  `await` so the handler returns before the write lands.
- Confirm writes are actually durable: the response the front-end gets reflects
  a *committed* row, not just an in-memory object.
- For each gap: propose the fix, and make sure the failure path now surfaces a
  real error to the front-end (and to the logs from section 3) instead of
  failing quietly.

## 5. Backend data validation
- Confirm every endpoint that accepts input validates it **server-side** — never
  trust front-end validation alone.
- Check for: type/shape validation, required-field enforcement, bounds/format
  checks (email, lengths, ranges, enums), and rejection of unexpected/extra
  fields where it matters.
- Validation failures should return a clear, structured error (which field,
  why) — useful to the front-end, without leaking internals.
- Flag endpoints with missing or partial validation and propose a consistent
  validation approach (a schema validator fitting the stack) rather than
  ad-hoc per-handler checks.

## 6. Plugin / dependency security
- Inventory backend dependencies and plugins (package manifest + lockfile;
  framework plugins/middleware).
- Check for: known-vulnerable versions (run the ecosystem's audit —
  `npm audit`, `pip-audit`, etc., if available), unmaintained/abandoned
  packages on critical paths, and plugins with broad privileges they don't need.
- Flag dependencies pulled from untrusted sources or pinned to mutable tags.
- Propose updates/replacements, noting any breaking-change risk; apply on
  confirmation, then run the verify loop (dependency bumps especially need it).

## 7. Other backend optimization
- Async/background work: long tasks moved off the request path (queues/jobs)
  rather than blocking responses.
- Connection & resource management: DB connection pooling sized sensibly, no
  leaked connections/handles, sensible timeouts on outbound calls.
- Caching strategy: appropriate cache layers with correct invalidation (flag
  any cache that risks stale/incorrect reads — correctness first).
- Config & environment: no dev settings (debug mode, verbose errors) enabled in
  a production path.
- Only propose optimizations that don't compromise data accuracy or
  consistency; when there's a tradeoff, state it explicitly and let the user
  decide.

## Output format
End a full run with a summary table:

| Area | Status | Key Issues Found | Action Taken / Recommended | Verified |
|---|---|---|---|---|
| Traffic / Data Loading | | | | |
| Endpoints, Bottlenecks & Heavy Loads | | | | |
| API Security & Logging | | | | |
| DB Write Integrity | | | | |
| Data Validation | | | | |
| Plugin/Dependency Security | | | | |
| Other Optimization | | | | |

"Verified" is marked only where fixes were applied and the verify loop passed;
blank where no fix was applied; "unresolved" where the loop stopped without
passing.

## Guardrails
- Don't apply destructive or production-affecting changes (migrations that drop
  data, deleting endpoints, cache purges on live traffic, dependency upgrades on
  a production deploy) without explicit confirmation.
- Security findings involving exposed secrets: flag for rotation, don't assume
  deleting the line from code is sufficient.
- Never introduce logging that writes secrets or PII, even to fix a diagnosis
  gap — redact at the source.
