// VERA page context — "answer from what the user is looking at".
//
// VERA used to receive only the page NAME, so a question about data plainly visible
// on screen ("what's the highest waste received here?") was answered as if it were a
// request for live system data and refused. This module captures a compact snapshot
// of the CURRENTLY RENDERED data and sends it with the question.
//
// Why harvest the DOM rather than wire every page: what is in the DOM is exactly
// what the user can see — already filtered, already sorted, already paginated, and
// including any open modal. One implementation therefore covers tables, statistics
// cards, data grids, search results and modal content across the whole app, with no
// per-page code and no risk of a page's snapshot drifting from what it renders.
//
// A page CAN publish something better (e.g. aggregates across all pages of a table
// rather than just the visible page) via setVeraPageContext — that takes priority.
//
// Token discipline is deliberate: everything is capped, numbers are kept verbatim as
// rendered, and row-level detail travels only when the question actually needs it.

const MAX_TABLES = 3;
const MAX_ROWS = 40;
const MAX_COLS = 12;
const MAX_CELL_CHARS = 60;
const MAX_STATS = 14;
const MAX_TOTAL_CHARS = 6000;

// Questions that need ROW-LEVEL data (ranking, extremes, arithmetic, lookups).
// Anything else gets the summary only, which keeps ordinary chat cheap.
const NEEDS_ROWS_RE =
  /\b(highest|lowest|max|maximum|min|minimum|top|bottom|largest|smallest|biggest|most|least|rank|ranking|sort|sorted|total|sum|average|avg|mean|median|count|how\s+many|which|who|what\s+is\s+the|compare|comparison|breakdown|list|per\s+\w+|between|greater|less|above|below|exceed|trend)\b/i;

// ── Optional explicit publisher ──────────────────────────────────────────────
let published = null;

/**
 * Publish a precise snapshot for the current page. Use when the DOM alone is not
 * enough — e.g. aggregates over a whole filtered dataset rather than the visible
 * page of a table. Call clearVeraPageContext() on unmount.
 *
 * @param {{label?:string, filters?:object, summary?:object, rows?:Array, columns?:Array, note?:string}} ctx
 */
export function setVeraPageContext(ctx) {
  published = ctx && typeof ctx === "object" ? ctx : null;
}

export function clearVeraPageContext() {
  published = null;
}

// ── DOM harvesting ───────────────────────────────────────────────────────────
const clean = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CELL_CHARS);

// Only what the user can actually see. offsetParent is null for anything inside a
// hidden tab panel or a closed modal, which is precisely what should be excluded.
function isVisible(el) {
  if (!el) return false;
  if (el.offsetParent === null) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function harvestTable(tableEl) {
  const headEls = tableEl.querySelectorAll(".ant-table-thead th");
  const columns = [...headEls]
    .slice(0, MAX_COLS)
    .map((th) => clean(th.innerText))
    .filter(Boolean);

  const rowEls = tableEl.querySelectorAll(".ant-table-tbody tr.ant-table-row");
  const rows = [...rowEls].slice(0, MAX_ROWS).map((tr) =>
    [...tr.querySelectorAll("td")].slice(0, MAX_COLS).map((td) => clean(td.innerText)),
  );

  const empty = !!tableEl.querySelector(".ant-table-placeholder");
  if (!columns.length && !rows.length) return null;
  return {
    columns,
    rows,
    visibleRowCount: rows.length,
    truncated: rowEls.length > rows.length ? rowEls.length : 0,
    empty: empty || rows.length === 0,
  };
}

// A table's nearest card/section title, so the model knows WHICH table it is.
function nearestLabel(el) {
  const card = el.closest(".ant-card, .ant-modal-content, .ant-tabs-tabpane, section");
  if (!card) return "";
  const t = card.querySelector(".ant-card-head-title, .ant-modal-title, h1, h2, h3, h4");
  return t ? clean(t.innerText) : "";
}

function harvestStats() {
  const out = [];
  for (const el of document.querySelectorAll(".ant-statistic")) {
    if (out.length >= MAX_STATS) break;
    if (!isVisible(el)) continue;
    const title = clean(el.querySelector(".ant-statistic-title")?.innerText);
    const value = clean(el.querySelector(".ant-statistic-content")?.innerText);
    if (title && value) out.push({ label: title, value });
  }
  return out;
}

// Active filter/search chips and inputs, so VERA reports on the FILTERED view and
// can say which filters are in force.
function harvestFilters() {
  const out = [];
  const push = (label, value) => {
    if (!value || out.length >= 10) return;
    out.push(label ? `${label}: ${value}` : value);
  };
  for (const el of document.querySelectorAll(".ant-select-selection-item, .ant-picker-input input, input.ant-input")) {
    if (out.length >= 10) break;
    if (!isVisible(el)) continue;
    const v = clean(el.value !== undefined ? el.value : el.innerText);
    if (!v) continue;
    const holder = el.closest(".ant-form-item, .ant-space-item, .ant-col");
    const lbl = holder?.querySelector(".ant-form-item-label label");
    push(lbl ? clean(lbl.innerText) : el.getAttribute("placeholder") || "", v);
  }
  return out;
}

function harvestDom(includeRows) {
  if (typeof document === "undefined") return null;

  // A modal, when open, IS the current view — prefer its tables over the page behind.
  const openModal = [...document.querySelectorAll(".ant-modal-wrap")].find(
    (m) => isVisible(m) && m.style.display !== "none",
  );
  const scope = openModal || document;

  const tables = [];
  for (const t of scope.querySelectorAll(".ant-table")) {
    if (tables.length >= MAX_TABLES) break;
    if (!isVisible(t)) continue;
    const data = harvestTable(t);
    if (!data) continue;
    tables.push({ label: nearestLabel(t), ...data });
  }

  const stats = harvestStats();
  const filters = harvestFilters();
  if (!tables.length && !stats.length) return null;

  return {
    inModal: !!openModal,
    modalTitle: openModal ? clean(openModal.querySelector(".ant-modal-title")?.innerText) : "",
    stats,
    filters,
    tables: includeRows
      ? tables
      : tables.map(({ rows, ...rest }) => ({ ...rest, rows: [] })),
  };
}

/**
 * Build the snapshot to send with a question. Returns null when the page has no
 * data worth sending, in which case VERA falls back to its knowledge base exactly
 * as before.
 */
export function buildVeraPageContext(message, page) {
  const includeRows = NEEDS_ROWS_RE.test(String(message || ""));
  let ctx = null;
  try {
    if (published) {
      ctx = { source: "page", label: published.label || page || "", ...published };
      if (!includeRows) delete ctx.rows;
    } else {
      const dom = harvestDom(includeRows);
      if (dom) ctx = { source: "dom", label: page || "", ...dom };
    }
  } catch {
    return null; // never let context capture break sending a message
  }
  if (!ctx) return null;

  // Hard size ceiling. Trim row-level detail first — the summary is what matters
  // most and costs least.
  let json = JSON.stringify(ctx);
  if (json.length > MAX_TOTAL_CHARS && Array.isArray(ctx.tables)) {
    for (const t of ctx.tables) {
      while (json.length > MAX_TOTAL_CHARS && Array.isArray(t.rows) && t.rows.length > 5) {
        t.rows.pop();
        json = JSON.stringify(ctx);
      }
    }
  }
  if (json.length > MAX_TOTAL_CHARS) {
    ctx.tables = (ctx.tables || []).slice(0, 1);
    ctx.truncatedForSize = true;
  }
  return ctx;
}

export default { setVeraPageContext, clearVeraPageContext, buildVeraPageContext };
