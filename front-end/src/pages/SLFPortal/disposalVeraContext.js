// What VERA is asked, and what it is shown, when a disposal (Waste Generator)
// upload is previewed.
//
// Same CONTRACT as haulerVeraContext.js / bulkVeraContext.js, and a plain module
// for the same reason: `pageContext` is sanitized by
// server/utils/veraPageData.sanitizePageContext and filtered again for portal
// users by portalSafePageContext in routes/vera.js. Either can discard the whole
// snapshot — sanitize returns null when there are no tables AND no stats, and the
// portal filter drops any table whose LABEL reads like an admin surface — after
// which VERA answers from its knowledge base with nothing in the UI saying so.
//
// WHAT IS DIFFERENT HERE
// ----------------------
// The other two contexts run only on a CLEAN preview, because there is nothing
// useful to say about a batch that has not passed validation yet. This one runs on
// a failing preview too, and that is the point of it.
//
// A machine-exported disposal file (see systemGeneratedUpload) fails for a reason
// the operator cannot act on from the error text alone: the file names one party
// per trip, the baseline names a hauler AND its client, and the mismatch surfaces
// as "Hauler … is not assigned under this SLF" for every row. The alignment pass
// has already worked out which names the baseline is actually missing; handing
// that list to VERA is what turns forty identical errors into "add these three
// clients under this hauler, then re-upload".
//
// Caps mirror the server's (MAX_ROWS 40, MAX_COLS 12, MAX_CELL 60).

export const DISPOSAL_VERA_TABLE_ROW_CAP = 40;

// The question. It has to satisfy server/utils/veraPageData.wantsPageData() —
// that gate decides whether the snapshot is spent on the prompt at all, so
// "summarize" / "how many" / "list" are load-bearing, not decorative.
export const DISPOSAL_VERA_ASSESSMENT_PROMPT =
  "Assess this disposal entry upload before I import it. " +
  "Summarize how many rows are ready and how many are blocked. " +
  "Separate the two kinds of problem, because the fixes are different: list the " +
  "client NAME MISMATCHES, where the baseline already holds the client under a " +
  "different spelling and the two just have to be reconciled — say which spelling " +
  "looks right and warn that adding it again would create a duplicate that splits " +
  "that client's volumes. Then list the records genuinely MISSING from the " +
  "baseline that must be encoded first — group the work by hauler, name the client " +
  "to add under each, and say how many trips in this file are waiting on it. " +
  "Where rows were matched to the baseline automatically, state plainly what was " +
  "matched to what so I can confirm it is right before importing. " +
  "If everything looks consistent, say so briefly.";

const cell = (value) =>
  value === null || value === undefined || value === "" ? "—" : String(value);

/**
 * Build the snapshot for a disposal preview.
 *
 * @param {Array}  rows      the parsed + aligned preview rows
 * @param {object} alignment summarizeAlignment's counts
 * @param {object} detection detectSystemGeneratedFile's verdict
 */
export function buildDisposalVeraContext(rows = [], alignment = null, detection = null) {
  const list = Array.isArray(rows) ? rows : [];
  const blocked = list.filter((row) => row?._errors?.length);
  const distinctHaulers = new Set(
    list.map((row) => String(row?.hauler || "").trim().toLowerCase()).filter(Boolean),
  );
  const distinctClients = new Set(
    list.map((row) => String(row?.client || "").trim().toLowerCase()).filter(Boolean),
  );
  const needsEncoding = alignment?.needsEncoding || [];

  return {
    source: "page",
    // NOTE: matched against a blocklist for portal users
    // (admin|developer|settings|users|logs|backlogs|raw|database|security|
    // credentials|permissions|system). Keep labels about disposal and haulers.
    label: "Waste Generator disposal upload — preview",
    inModal: true,
    modalTitle: "Preview Uploaded Data (Disposal Entries)",
    filters: [],
    stats: [
      { label: "Rows in file", value: String(list.length) },
      { label: "Rows ready to import", value: String(list.length - blocked.length) },
      { label: "Rows blocked", value: String(blocked.length) },
      {
        label: "File appears system-generated",
        value: detection?.isSystemGenerated ? "Yes" : "No",
      },
      {
        label: "Rows repeating the same name in Hauler and Client",
        value: String(detection?.mirroredRows ?? 0),
      },
      {
        label: "Trailing rows with no trip data, left out",
        value: String(detection?.skippedStrayRows ?? 0),
      },
      { label: "Rows matched to the baseline automatically", value: String(alignment?.alignedCount ?? 0) },
      { label: "Rows with more than one possible match", value: String(alignment?.ambiguousCount ?? 0) },
      // Mismatches are called out separately from missing records because the
      // remedy differs: a mismatch is one client spelled two ways and is fixed by
      // agreeing on a spelling, NOT by adding a second record — which would split
      // that client's volumes across two.
      { label: "Client name mismatches (same client, different spelling)", value: String((alignment?.mismatches || []).length) },
      { label: "Rows blocked by a name mismatch", value: String(alignment?.mismatchCount ?? 0) },
      ...(alignment?.mismatches || []).slice(0, 6).map((entry) => ({
        label: `Mismatch under ${entry.hauler} — file says "${entry.client}"`,
        value: `baseline has "${(entry.suggestions || [])[0]?.name || "?"}" · ${entry.rows} trip(s)`,
      })),
      { label: "Distinct haulers in file", value: String(distinctHaulers.size) },
      { label: "Distinct clients in file", value: String(distinctClients.size) },
      { label: "Names missing from the baseline", value: String(needsEncoding.length) },
      // The actionable list, spelled out as stats so it survives even if the
      // table below is trimmed by the server's row cap.
      ...needsEncoding.slice(0, 8).map((item) => ({
        label: `Not on the baseline — "${item.label}"`,
        value: `${item.rows} trip(s) in this file`,
      })),
    ],
    tables: [
      {
        label: "Disposal rows and how each resolved",
        // 9 columns — inside the server's MAX_COLS of 12.
        columns: [
          "Line",
          "Ticket No",
          "Hauler (resolved)",
          "Client (resolved)",
          "As written in file",
          "Match",
          "Volume",
          "Cell",
          "Problem",
        ],
        rows: list.slice(0, DISPOSAL_VERA_TABLE_ROW_CAP).map((row) => [
          cell(row?._rowNumber),
          cell(row?.disposalTicketNo),
          cell(row?.hauler),
          cell(row?.client),
          cell(row?._alignment?.originalHauler || row?.hauler),
          cell(row?._alignment?.status || (row?._errors?.length ? "blocked" : "exact")),
          row?.actualVolume != null ? String(row.actualVolume) : "—",
          cell(row?.cellName),
          // The server truncates each cell to 60 chars, so the first error is
          // what survives — which is the one the operator has to fix first.
          String((row?._errors || [])[0] || ""),
        ]),
        visibleRowCount: Math.min(list.length, DISPOSAL_VERA_TABLE_ROW_CAP),
        // Becomes `totalRowCount` server-side, so VERA is told the batch is
        // larger than the sample it can see.
        truncated: list.length,
        empty: list.length === 0,
      },
    ],
  };
}

export default {
  buildDisposalVeraContext,
  DISPOSAL_VERA_ASSESSMENT_PROMPT,
  DISPOSAL_VERA_TABLE_ROW_CAP,
};
