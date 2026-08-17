// What VERA is asked, and what it is shown, when a bulk cell-placement upload
// validates cleanly.
//
// This is deliberately a plain module rather than logic inside the modal, because
// it is one half of a CONTRACT with the server: `pageContext` is sanitized by
// server/utils/veraPageData.sanitizePageContext, and a portal user's snapshot is
// then filtered again by portalSafePageContext in routes/vera.js. Either can throw
// the whole snapshot away — sanitize returns null when there are no tables AND no
// stats, and the portal filter drops any table whose LABEL reads like an admin
// surface. When that happens VERA still answers, but from its knowledge base
// instead of the operator's data, and nothing in the UI says so.
//
// Keeping the shape here means the contract can be tested against the server's own
// sanitizer instead of being assumed.
//
// Caps mirror the server's (MAX_ROWS 40, MAX_COLS 12, MAX_CELL 60) so nothing is
// sent that would only be discarded.

export const VERA_TABLE_ROW_CAP = 40;

// The question. It has to satisfy server/utils/veraPageData.wantsPageData() —
// that gate is what decides whether the snapshot is spent on the prompt at all, so
// the wording is load-bearing, not decorative. "Summarize", "how many" and "list"
// are the terms it recognises.
export const VERA_ASSESSMENT_PROMPT =
  "Assess this validated bulk cell-placement upload before I apply it. " +
  "Summarize how many placements go to each target cell, and list any rows that " +
  "look risky — a cell close to its remaining capacity, an unusually large volume, " +
  "or waste being moved out of a cell it already sits in. " +
  "If everything looks consistent, say so briefly.";

const cell = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));

/**
 * Build the snapshot for a clean validation.
 *
 * @param {Array}  rows    the SERVER-validated preview rows (never the raw file)
 * @param {object} summary the server's { total, valid, invalid, warning } counts
 */
export function buildBulkVeraContext(rows = [], summary = null) {
  const list = Array.isArray(rows) ? rows : [];

  // Per-cell distribution, so VERA can comment on the shape of the batch without
  // having to be sent every row to count them itself.
  const perCell = new Map();
  list.forEach((r) => {
    const name = r?.targetCell || "—";
    perCell.set(name, (perCell.get(name) || 0) + 1);
  });

  return {
    source: "page",
    // NOTE: these labels are matched against a blocklist for portal users
    // (admin|developer|settings|users|logs|backlogs|raw|database|security|
    // credentials|permissions|system). Keep them about cells and placements.
    label: "Bulk Organize Cells — validated placements",
    inModal: true,
    modalTitle: "Bulk Organize Cells (File Upload)",
    filters: [],
    stats: [
      { label: "Placements validated", value: String(summary?.total ?? list.length) },
      { label: "Ready to apply", value: String(summary?.valid ?? 0) },
      { label: "Already placed (reassignment)", value: String(summary?.warning ?? 0) },
      { label: "Distinct target cells", value: String(perCell.size) },
      ...[...perCell.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, count]) => ({ label: `Placements into ${name}`, value: String(count) })),
    ],
    tables: [
      {
        label: "Validated cell placements",
        columns: [
          "Line", "Ticket No", "Capacity", "Submission",
          "Target Cell", "Remaining m3", "Status", "Message",
        ],
        rows: list.slice(0, VERA_TABLE_ROW_CAP).map((r) => [
          cell(r?.row),
          cell(r?.disposalTicketNo),
          r?.truckCapacity != null ? String(r.truckCapacity) : "—",
          cell(r?.submissionId),
          cell(r?.targetCell),
          r?.remaining == null ? "—" : String(Math.round(Number(r.remaining) * 10) / 10),
          cell(r?.status),
          // Kept as-is; the server truncates each cell to 60 chars.
          String(r?.message || ""),
        ]),
        visibleRowCount: Math.min(list.length, VERA_TABLE_ROW_CAP),
        // Becomes `totalRowCount` server-side, so VERA is told the batch is larger
        // than the sample it can see rather than reasoning as if 40 were all of it.
        truncated: list.length,
        empty: list.length === 0,
      },
    ],
  };
}

export default { buildBulkVeraContext, VERA_ASSESSMENT_PROMPT, VERA_TABLE_ROW_CAP };
