---
name: split-large-jsx
description: Break up oversized React JSX files in this app (front-end/) into organized, cohesive groups of smaller files — a feature folder with a thin index.jsx plus extracted subcomponents, modals/tabs, custom hooks, constants, and helpers. Behavior-preserving refactor, not a rewrite. Use whenever the user says "this file is too long", "split AdminHome", "organize the jsx files", "break up this component", "refactor this 5000 line file", "avoid huge files", "this component is 10000 lines", or points at any large .jsx (SLFMonitoring, SLFPortal/index, SubmissionSettings, DeveloperSettings, etc.) and wants it organized into groups.
---

# Split Large JSX Files into Organized Groups

Turn a giant page component into a **feature folder**: a thin `index.jsx`
orchestrator plus a small set of cohesive files (subcomponents, modals/tabs,
hooks, constants, helpers). The goal is readability and maintainability, not a
line-count game — so the work is **behavior-preserving refactoring**: the
rendered UI and every interaction must be identical before and after. If the
temptation to "improve it while I'm here" appears, resist it — feature changes
and refactors are separate passes.

Work the way the house skills do: **measure → propose a structure → get it
confirmed → extract in small verified steps.** A 9,000-line file cut apart all
at once and tested at the end is a debugging nightmare; extract one seam at a
time and verify between each.

## This repo's conventions (match them, don't invent new ones)

- **Plain Vite + React, no path aliases** — imports are relative. When you move a
  file down into a new folder, every `../` shifts by one level. Get this right or
  the build breaks immediately.
- **Established "group" precedent — follow it exactly:**
  - `pages/SLFPortal/` = `index.jsx` (container) + `SLFPortalModals.jsx` +
    `DraftsScheduledPanel.jsx` + `constants.js` + `SLFPortal.css`.
  - `pages/admin/slf-monitoring/` = `SlfDashboardTab.jsx` + `PortalGenerators.jsx`
    + `WasteBaselineInfo.jsx` + `helpers.jsx`.
- **Shared across ≥2 pages → `src/components/`** (precedent: `GaugeMeter.jsx`).
- **Pure shared utilities → `src/utils/`** (precedent: `tablePagination.js`,
  `excludeDummy.js`, `exportExcel.js`). Feature-only helpers stay in the feature
  folder.
- **Naming:** PascalCase for component files (`FooModal.jsx`, `FooTab.jsx`),
  `useFoo.js` for hooks, `constants.js` for static data, `helpers.js`/`.jsx` for
  pure functions, `Foo.css` colocated with its feature.
- **UI stack is Ant Design** (`antd` + `@ant-design/icons`) — Table `columns`,
  Form field configs, and Modal bodies are the cleanest extraction targets.

**Current worst offenders** (from `wc -l`, for picking targets):
`AdminHome.jsx` ~10.4k · `SLFPortal/index.jsx` ~9.9k · `admin/SLFMonitoring.jsx`
~9.9k · `SLFPortal/SLFPortalModals.jsx` ~5.6k · `admin/SubmissionSettings.jsx`
~5.0k · `admin/DeveloperSettings.jsx` ~3.2k.

## Sizing targets (cohesion first, line count second)

- Soft target: a file reads comfortably at **≤ ~400–500 lines**.
- Strong candidate to split: **> ~800 lines**.
- The 5k–10k files are emergencies — but don't overcorrect. Shattering one 9k
  file into 60 files of 30 lines is *not* organized; it's just scattered. Aim for
  **cohesive units** (~150–500 lines) where the code inside changes together and
  shares state. Cohesion beats hitting a number.

## Step 0 — Measure and pick one target

- `wc -l` the candidates; pick the single worst (or the one the user named).
- Detect the verify command: `front-end/` uses Vite — `npm run build` and/or
  `npm run lint`. That's what the per-step verify loop runs. Also plan to drive
  the actual page (the `verify` skill / preview server) since a build pass does
  not prove the UI still behaves.
- Do **one file per pass.** Don't fan out across AdminHome + SLFMonitoring in the
  same session.

## Step 1 — Map the seams (inventory before you cut)

Read the file and inventory it — grep for the structural markers rather than
reading 10k lines linearly:

- **Static data**: option arrays, enums, antd `columns` defs, Form field configs,
  default form values, regexes, label maps. (grep `const .* = [` , `columns`)
- **Pure helpers**: formatters, validators, mappers, `computeX` — functions with
  no hooks and no component state. (grep `function `, `const .* = (`)
- **State clusters**: groups of `useState`/`useReducer` that are read and written
  together by the same UI region. (grep `useState`, `useEffect`, `useCallback`,
  `useMemo`) — these define hook and subcomponent boundaries.
- **Render regions that look like components**: modals, drawers, tabs, panels,
  cards, table blocks — self-contained chunks of JSX. (grep `<Modal`, `<Drawer`,
  `<Tabs`, `<Table`, big `{condition && (` blocks)

Output a **proposed group tree** and the seams it came from, e.g.:

```
pages/admin/SLFMonitoring/
├── index.jsx            # container: data fetch, top-level state, composition
├── constants.js         # column defs, filter options, status maps
├── helpers.js           # pure formatters/mappers
├── useMonitoringData.js # fetch + derived state hook
├── OverviewTab.jsx
├── SubmissionsTab.jsx
└── CellCapacityPanel.jsx
```

## Step 2 — Propose, then get confirmation

Show the user the tree, the rough size of each piece, and the extraction order.
Splitting a page touched by routing and shared imports is not something to do
silently — **wait for confirmation** before moving code (unless they said "just
do it"). This is also where they can veto a boundary you got wrong.

## Step 3 — Extract in risk order (verify + commit each step)

Extract lowest-risk first so a mistake is cheap to find. **Verify after every
single extraction** (build/lint + drive the touched flow); make each extraction
its own commit so the diff is reviewable and revertible.

1. **Static data → `constants.js`** (near-zero risk). Move option arrays, enums,
   label maps, and antd `columns`/Form configs *that don't close over component
   state*. If a column's `render` uses a handler or state, it is **not** static —
   convert it to a factory `makeColumns({ onEdit, onDelete })` the container
   calls, or leave it. Put shared constants here, never back-import them from
   `index.jsx` (that causes circular imports).

2. **Pure helpers → `helpers.js`** (`.jsx` only if they return JSX from plain
   args). No hooks, no state, no `this`. These are the safest real code to move.

3. **Presentational leaf components → sibling `.jsx` (or `src/components/` if
   reused)**. Extract JSX regions that only *read props* — cards, rows, badges,
   read-only panels. Pass exactly the props they consume. Define them at module
   scope (never inside the parent's render — that remounts on every render and
   drops state/focus).

4. **Modals / drawers / tabs / panels → sibling `.jsx`** (precedent:
   `SLFPortalModals.jsx`, `DraftsScheduledPanel.jsx`, `SlfDashboardTab.jsx`).
   These usually own a cohesive slice of state. **Lift that slice with them** —
   move its `useState`/handlers into the child (or a hook) rather than drilling 20
   props. If a child would need **more than ~8–10 props**, the boundary is wrong:
   either extract a bigger chunk that owns the state, or extract a hook instead.

5. **State logic → custom hooks `useFoo.js`**. When a cluster of state, effects,
   and handlers moves together (e.g. all the Excel-upload state + handlers, or all
   the fetch + derived-data logic), lift it into a hook that returns the values
   and handlers the container needs. This is the highest-leverage move for files
   dominated by logic rather than markup. Move the state **with** its effects and
   handlers so closures stay intact — a handler left behind that references moved
   state becomes a stale-closure bug.

6. **`index.jsx` becomes the thin orchestrator** — top-level data, composition of
   the extracted pieces, routing glue. It should end up readable end to end.

## Step 4 — Confirm behavior is identical

- Build + lint clean, no new console warnings (watch for remount/`key` warnings
  and stale-closure bugs introduced by the move).
- Drive the real flows on the page you split — the interactions, not just that it
  renders. For SLF pages, the `slf-portal-review` skill's flows are a good
  checklist.
- Report the before/after: file count, line counts, and the final group tree.

## Anti-patterns (these make it worse, not better)

- **Prop-drilling explosion**: extracting a child that closes over parent state
  and then passing it back as 25 props. Extract the *state's* home, not just the
  markup.
- **Over-fragmentation**: dozens of tiny files with one component each, imported
  in long chains. Group by cohesion; a 400-line file that reads as one idea beats
  eight 50-line files you have to hop between.
- **Behavior drift**: renaming props, "tidying" logic, changing a default while
  moving it. Keep the move mechanical; do improvements in a separate pass.
- **Circular imports**: `index.jsx` imports `FooTab`, `FooTab` imports a const
  from `index.jsx`. Shared values live in `constants.js`/`helpers.js`.
- **Broken relative paths**: forgetting that a file moved into a subfolder needs
  every `../` re-counted, and that other files importing the moved code need
  their paths updated too.
- **Inline component definitions moved wrong**: a component defined inside render
  must go to module scope on extraction, or it remounts every render.

## Output format

End a run with the proposed/applied structure and a per-extraction table:

| Extracted | New file | ~Lines moved | Kind (const/helper/component/hook) | Verified |
|---|---|---|---|---|

Plus the headline: `index.jsx: 9,912 → 780 lines; 1 file → 7 files`. Mark
"Verified" only where build/lint passed *and* the flow was driven; leave blank if
proposed-not-applied; "unresolved" if verification failed.

## Guardrails

- One file per pass; get the structure confirmed before moving code (unless told
  to proceed); commit per extraction so any step is revertible.
- Never mix a behavior change into the split — if you spot a real bug, note it and
  handle it separately.
- Don't relocate a component into `src/components/` unless it's genuinely reused;
  premature "shared" folders scatter feature code. Keep feature-local code in the
  feature folder next to its `index.jsx`.
