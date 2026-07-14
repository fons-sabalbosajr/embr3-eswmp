---
name: crud-performance-check
description: End-to-end CRUD, live-refresh, and performance/RAM audit for this app — verifies that saving, adding, updating, and deleting actually persist to MongoDB and reflect in the UI; that a change made in one place refreshes everywhere in real time (socket.io) without stale data, double-fetching, or full-page reloads that cause bottlenecks; and measures peak RAM, request latency, and UI responsiveness during CRUD. Use whenever the user says "check the CRUD", "is saving/updating/deleting working", "test add/edit/delete", "why isn't my data saving", "does the app refresh when data changes", "check for stale data", "the app feels slow/laggy", "check RAM/memory usage", "check performance", "is there a bottleneck", "measure CRUD speed", or asks about save/update/add/delete correctness, real-time refresh, memory peaks, or CRUD responsiveness.
---

# CRUD, Live-Refresh & Performance Check

A structured pass that answers three questions for this app's Create / Read /
Update / Delete flows:

1. **Correctness** — does saving, adding, updating, and deleting actually land in
   the database and come back correctly?
2. **Freshness** — when data changes, does every view that shows it refresh
   (ideally in real time over socket.io) without going stale, without redundant
   re-fetching, and without a heavy full-page reload that bottlenecks the app?
3. **Cost** — how much RAM does it peak at, how fast are the operations, and does
   the UI stay responsive while they run?

For each section: **report findings first, then propose fixes, then apply only
what the user confirms** (unless they've said "auto-fix everything" up front).
Measurement before opinion — this skill is about observing real behavior, not
guessing from the code alone.

## The stack (already known — don't re-derive)
- **Front-end**: React 19 + Vite, `axios` instance in `front-end/src/api.js`
  (baseURL `/eswm-pipeline/api`), `socket.io-client` for live updates,
  `sweetalert2` for confirm/success dialogs, antd + recharts for UI.
- **Backend**: Express 5, Mongoose 9 → MongoDB, `socket.io` for real-time push,
  JWT auth (admin `token` + portal `portal_token`), `multer` for uploads.
- **Two apps share the codebase**: the admin side and the SLF Portal side. CRUD
  correctness *and* data isolation between portal users both matter — a refresh
  that leaks one portal user's write into another's view is a correctness bug,
  not just a freshness one. See the `slf-portal-review` skill for the portal side.
- **Run commands**: front-end `npm run dev` (Vite) in `front-end/`; server
  `npm run dev` (nodemon) or `npm start` in `server/`. There is **no test suite**
  (`server` test script just errors), so the verify loop below leans on driving
  the real app, not on `npm test`.

## 0. Context gathering (do this first)
- Confirm both apps start and the server connects to MongoDB (watch the server
  log on boot). If it can't reach the DB, stop and surface that — every CRUD
  check downstream would be meaningless.
- Pick the CRUD surface to exercise. Don't try to cover everything; ask the user
  which entity/flow they care about, or default to the highest-traffic ones:
  SLF submissions / queue, transactions, portal users, facilities, settings.
- Locate the flow for that entity end to end: front-end call site → `api.js` →
  the Express route in `server/routes/*` → the Mongoose model in `server/models/*`
  → the socket event (if any) that announces the change.
- Decide how you'll drive the app. Prefer the **Browser tool** to click through
  real UI (that's the only way to measure real responsiveness and front-end
  RAM); fall back to hitting the API directly with the right auth token when you
  only need to confirm persistence.

**Verifying fixes**: there's no `npm test` here, so after applying any change,
verify by *re-driving the affected flow in the running app* and observing the
outcome — not by assuming. If a change touches the server, restart nodemon (or
confirm it hot-reloaded) before re-testing. Never leave a change
applied-but-unverified.

## 1. CRUD correctness — saving, adding, updating, deleting
Exercise each operation against **test/dummy records**, and confirm the write is
*durable* (a committed DB row), not just an optimistic UI success.

- **Create / Add**: submit a new record through the UI. Confirm (a) the API
  returns success with the persisted object (including its new `_id`), (b) a real
  document exists in MongoDB, and (c) it appears in the list/table without a
  manual hard refresh.
- **Read**: confirm lists, detail views, and dashboards load the record and show
  the correct values (units, dates, computed fields). Watch for reads scoped
  wrong — e.g. a portal user seeing another portal user's rows.
- **Update / Save**: edit a field and save. Confirm the change persists to the DB
  and that *every* view showing that record reflects the new value (see §2).
  Watch for the classic silent-drop culprits: a missing `await` so the handler
  returns before the write lands; a transaction/save whose result is ignored; a
  broad `try/catch` swallowing a validation or constraint error while the UI
  still shows "Saved".
- **Delete**: delete a **dummy** record and confirm it's gone from the DB and
  from all views. Check soft-delete vs hard-delete behavior matches intent, and
  that delete-requests / approval flows (e.g. `haulerDeleteRequests`) actually
  complete.
- For any operation where the UI reported success but the DB didn't change (or
  vice-versa), that's the headline finding — trace exactly where the path breaks
  and propose the fix so the failure path surfaces a real error instead of
  failing quietly.
- Report as a table: `Entity | Operation | UI result | DB result | Reflects in UI? | Issue | Fix`.

## 2. Live refresh, stale data & reload bottlenecks
This is the "does the app update when something changes, without choking"
section. The app uses socket.io for this, so check that the push path works and
is efficient.

- **Real-time propagation**: make a change in one client/tab and confirm other
  open views update **without a manual reload**. Trace the socket event: server
  `io.emit(...)` on write → client listener → state update. Flag writes that
  emit *no* event (so other clients go stale until they refetch) and listeners
  that are registered but never fire.
- **Stale reads**: look for views that cache data and never invalidate it after a
  related write — the user sees old numbers until they navigate away and back.
  The SLF Dashboard capacity gauges are a common victim: a new submission must
  move the gauge, not leave it stale.
- **Reload bottlenecks (the thing to avoid)**: flag anywhere the app responds to
  a small change with a heavy response — refetching an entire table after
  editing one row, a full `window.location.reload()`, re-running an expensive
  aggregation on every socket event, or every open tab hammering the same
  endpoint at once. Prefer targeted updates (patch the one changed item in state,
  or a scoped refetch) over full reloads.
- **Socket hygiene**: confirm listeners are cleaned up on unmount (a `useEffect`
  returning an `off`/`disconnect`), or they stack up on every mount — a
  correctness bug (handlers fire multiple times) *and* a memory leak (see §3).
  Confirm the client reconnects cleanly and doesn't miss events after a drop.
- Report as a table: `Change source | Views that should update | Updates live? | Stale/bottleneck risk | Fix`.

## 3. RAM peak usage
Measure real memory, don't estimate. Do it on both sides, and specifically look
for growth that never comes back down (a leak) versus a legitimate one-time peak.

**Server (Node process):**
- Baseline then peak: watch the node process RSS while a CRUD-heavy flow runs.
  On Windows: `Get-Process node | Select-Object Id, @{n='RSS(MB)';e={[math]::round($_.WorkingSet64/1MB,1)}}`
  before, during, and after the run.
- For in-process detail, read `process.memoryUsage()` (`rss`, `heapUsed`,
  `external`) — add a temporary `/debug/mem` route or log it around the operation
  if no memory visibility exists, then remove it after.
- **Leak signal**: run the same create/update/delete cycle ~20–50× and see
  whether `heapUsed` returns near baseline after a GC or keeps climbing. Usual
  suspects here: socket listeners accumulating, large Mongoose result sets held
  in closures, unbounded in-memory caches/arrays, `multer` buffering big uploads
  in memory.
- Note the `--max-old-space-size` ceiling if set, and whether peak approaches it.

**Front-end (browser):**
- Drive the app in the Browser tool and use the Performance/Memory panel (or
  `performance.memory.usedJSHeapSize` via the JS console) to capture heap before
  and after repeated CRUD.
- **Leak signal**: repeat open-modal → edit → save → close ~20× and take a heap
  snapshot; detached DOM nodes and ever-growing listener counts mean the
  component isn't cleaning up (React effect cleanup, socket `off`, chart/leaflet
  instances not disposed).
- Report as a table: `Side | Scenario | Baseline | Peak | Returns to baseline? | Leak suspect | Fix`.

## 4. CRUD performance — speed & latency
Put numbers on each operation so "slow" becomes specific.

- **Per-operation latency**: measure wall-clock time for create / read / update /
  delete. Server-side, add lightweight timing (log `Date.now()` delta around the
  handler, or a timing middleware) if none exists; client-side, read timings from
  the Browser network panel or wrap the `axios` call. Report p50 and the worst
  case, not just one sample.
- **Find the slow path**: for anything slow, split the time between network,
  server handler, and DB query. On the DB side check for N+1 queries, missing
  indexes on filtered/sorted fields, `find()` returning whole collections where a
  filter/projection/pagination belongs, and expensive aggregations run on every
  request instead of cached.
- **Payload weight**: flag endpoints shipping full tables or fat documents to the
  client when a slice would do — big payloads slow both the network and the
  browser that has to render them.
- Report as a table: `Operation | p50 | worst | Network / Server / DB split | Bottleneck | Fix`.

## 5. UI responsiveness during CRUD
Speed on the wire isn't enough — the app has to *feel* responsive while writes
happen.

- **Loading & disabled states**: every async save/add/update/delete shows a
  pending state and disables its trigger so it can't double-fire. Flag buttons
  that can be clicked twice into duplicate writes, and paths that hang with no
  spinner.
- **Optimistic vs confirmed**: where the UI updates optimistically, confirm it
  reconciles with the server result and rolls back on failure (with a clear
  sweetalert2 error), rather than showing success over a failed write.
- **Main-thread blocking**: watch for jank during CRUD — a big client-side sort,
  an xlsx parse, or re-rendering a huge table on every keystroke will freeze the
  UI. In the Browser Performance panel, look for long tasks (>50ms) around the
  operation. Propose debouncing inputs, virtualizing long lists/tables,
  memoizing, or moving heavy work off the main path.
- **Perceived speed**: confirm the app stays interactive during the operation
  (can scroll, can cancel) rather than locking up until the response returns.
- Report as a table: `Interaction | Loading state? | Double-fire guarded? | Jank/long task? | Fix`.

## Output format
End a full run with this summary:

| Area | Status | Key Findings (with numbers) | Action Taken / Recommended | Verified |
|---|---|---|---|---|
| CRUD Correctness (save/add/update/delete) | | | | |
| Live Refresh & Reload Bottlenecks | | | | |
| RAM Peak Usage | | | | |
| CRUD Speed & Latency | | | | |
| UI Responsiveness | | | | |

Put real measurements in "Key Findings" (e.g. "update p50 480ms, worst 2.1s;
server RSS peaked 512MB and returned to 190MB — no leak"). "Verified" is marked
only where a fix was applied and re-driving the flow confirmed it; blank where no
fix was applied; "unresolved" where a fix was tried but the behavior didn't
improve.

## Guardrails
- **Never run destructive CRUD against real data.** Create clearly-labeled dummy
  records for the create/update/delete exercises and delete only those. If you
  can't tell test data from real data, ask before deleting anything.
- **Don't stress/load-test a production or shared environment** without explicit
  confirmation — repeated CRUD cycles and concurrent requests can disrupt live
  users. Prefer a local dev instance for the RAM-leak and latency loops.
- Remove any temporary instrumentation you add (debug `/mem` routes, timing
  logs, console memory dumps) once measurements are captured — don't leave
  diagnostic code or secret-exposing logs in the app.
- Optimizations must not trade correctness or data integrity for speed. Caching
  that risks a stale read, or dropping in-flight requests via debounce, needs the
  tradeoff stated explicitly so the user decides.
- Cross-portal-user isolation is a hard correctness line: a refresh/optimization
  that lets one portal user's write appear in another's view is a bug to fix, not
  a performance win to keep.
