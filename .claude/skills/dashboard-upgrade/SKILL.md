---
name: dashboard-upgrade
description: Modernizes and upgrades an app's dashboard — data visualization, layout, information hierarchy, and metric presentation. Free to boldly restructure layout and hierarchy, not just repaint. Use whenever the user says "upgrade my dashboard", "modernize the dashboard", "make the dashboard look better", "improve my dashboard UI", "redesign the metrics page", or asks to improve how data/charts/KPIs are presented in an app. Trigger for dashboard, admin panel, analytics view, metrics page, or reporting screen improvements.
---

# Dashboard Upgrade

Take an existing app dashboard from functional-but-dated to genuinely modern —
better data visualization, cleaner layout, sharper information hierarchy, and
metrics that are actually readable at a glance. **Default posture: bold.** You
are free to restructure the layout and hierarchy, not just restyle it. Rework
what the dashboard leads with, how it groups metrics, and how it uses space —
don't just repaint the existing boxes. The goal is a dashboard someone is glad
to open, not one that merely renders.

## 0. Understand before redesigning (do this first)
- Identify the stack: framework, component library, styling approach
  (Tailwind, CSS modules, styled-components, etc.), and any existing chart
  library already in use.
- **Charts follow the existing stack.** If the project already uses a chart
  library (Recharts, Chart.js, ECharts, D3, etc.), stay with it — don't
  introduce a second one. Only if none exists, recommend one that fits the
  framework and note why before adding it.
- Identify the real data: what metrics exist, their shape (time series,
  categorical, single KPI, distribution), update frequency, and which ones
  actually matter to the user of this dashboard. The data determines the
  visualization — not the other way around.
- Note the current information hierarchy: what's shown first, what's buried,
  what's given equal weight that shouldn't be.

## 1. Rethink the hierarchy (the highest-leverage step)
Most dated dashboards fail here first: everything has equal visual weight, so
nothing stands out. Before touching styling:
- Identify the 3–5 metrics that matter most. These earn the top of the view
  and the most visual weight.
- Demote secondary metrics into smaller cards, a secondary row, or a
  drill-down — don't give a vanity metric the same real estate as a critical one.
- Group related metrics so the eye reads clusters, not a wall of equal boxes.
- Establish a clear scan path: top-left / most prominent = most important, and
  it flows outward from there.
State the proposed hierarchy in plain terms before building it, so the user can
redirect if their priorities differ from what the data suggests.

## 2. Match each metric to the right visualization
Pick the chart from the metric's shape, not from what looks impressive:
- **Single KPI / current state** → big-number stat card, optionally with a
  small delta vs. prior period and a sparkline. Don't put a single number in a
  pie chart.
- **Trend over time** → line or area chart. Multiple series → line; part-to-
  whole over time → stacked area (only if the parts genuinely sum to a whole).
- **Comparison across categories** → bar chart (horizontal if labels are long).
- **Part-to-whole, one snapshot** → a single donut/stacked bar — avoid pie
  charts with more than ~5 slices; they become unreadable.
- **Distribution** → histogram or box plot.
- **Relationship between two variables** → scatter.
- **Dense tabular data** → a well-designed table with sorting, not a chart
  forced onto it.
Flag any existing chart that's the wrong type for its data and propose the swap.

## 3. Modern layout & visual execution
Apply current dashboard conventions:
- **Responsive grid** — a card/tile grid that reflows across breakpoints
  (multi-column on wide screens, single column on mobile), not a fixed layout.
- **Whitespace and grouping** — generous padding, clear separation between
  metric groups; density should feel intentional, not cramped.
- **Consistent card system** — one reusable stat-card / chart-card pattern with
  consistent internal spacing, title placement, and value styling, rather than
  each metric styled ad hoc.
- **Restrained color with meaning** — use color to encode (good/bad,
  category, threshold breach), not for decoration. Keep a limited palette;
  let one accent carry emphasis. Ensure sufficient contrast for readability.
- **States that exist** — every chart/card needs a loading state (skeleton),
  an empty state ("No data yet" with context, not a blank box), and an error
  state. Dated dashboards usually skip these.
- **Typography hierarchy** — metric values large and clear, labels quiet and
  secondary; use tabular/monospaced figures for numbers so they don't jitter
  as values change.
- **Micro-interactions, used sparingly** — hover tooltips on charts, subtle
  transitions on data updates. Don't over-animate; excessive motion reads as
  unpolished.

Consult the `frontend-design` skill for deeper direction on palette,
typography pairing, and avoiding a templated look — this skill covers the
dashboard-specific structure; that one covers making it feel distinctive rather
than default.

## 4. Preserve the data contract
Bold on layout, careful on data. A visual upgrade must not:
- Change, round, or misrepresent the underlying values.
- Drop metrics the user relies on without flagging it first.
- Break the wiring between the data source and the display (loading logic,
  refresh intervals, filters, date ranges).
Re-verify that every metric still reads from its correct source and shows the
correct value after the restructure. If a chart type change alters how a value
is aggregated (e.g. summing vs. averaging), call that out explicitly.

## 5. Verify the upgrade
After applying changes, confirm it actually works before declaring done:
- Run the project's build/test command if one exists; fix and re-run on
  failure (short fix-run-repeat loop, stop on pass or after ~10 tries), same
  as the `debug-loop` protocol.
- Check the dashboard renders across breakpoints (mobile → wide) without
  overflow, overlap, or broken grids.
- Confirm loading, empty, and error states each render correctly, not just the
  happy path with data present.

## Working style
- For a **bold restructure**, sketch the new layout in plain terms (or an ASCII
  wireframe) and confirm the direction with the user before writing a large
  amount of code — a restructure is expensive to redo. Smaller per-component
  improvements can just be applied and shown.
- Show the reasoning for hierarchy and chart-type choices briefly; the "why"
  is what lets the user trust or redirect the redesign.
- Don't gold-plate: match effort to the dashboard's importance, and stop when
  it's clearly better rather than endlessly polishing.

## Report back
When done, summarize concisely:
- What the new hierarchy leads with and why.
- Which charts changed type, and the data reason for each.
- Layout/system changes (grid, card pattern, states added).
- Anything left as a follow-up or needing the user's data-priority call.
