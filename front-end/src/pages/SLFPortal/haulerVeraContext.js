// What VERA is asked, and what it is shown, when an Accredited Haulers upload
// previews cleanly.
//
// Same CONTRACT as bulkVeraContext.js, and a plain module for the same reason:
// `pageContext` is sanitized by server/utils/veraPageData.sanitizePageContext and
// then filtered again for portal users by portalSafePageContext in
// routes/vera.js. Either can throw the whole snapshot away — sanitize returns
// null when there are no tables AND no stats, and the portal filter drops any
// table whose LABEL reads like an admin surface. When that happens VERA still
// answers, but from its knowledge base instead of the operator's data, and
// nothing in the UI says so. Keeping the shape here means the contract can be
// tested against the server's own sanitizer instead of assumed.
//
// Caps mirror the server's (MAX_ROWS 40, MAX_COLS 12, MAX_CELL 60).

export const HAULER_VERA_TABLE_ROW_CAP = 40;

// The question. It has to satisfy server/utils/veraPageData.wantsPageData() —
// that gate decides whether the snapshot is spent on the prompt at all, so the
// wording is load-bearing, not decorative ("summarize", "how many", "list").
//
// What it asks for is chosen around what this import can get WRONG QUIETLY. The
// validator already blocks the loud failures; VERA is pointed at the ones that
// import successfully and are only discovered later:
//   · a near-miss hauler name that adds a second hauler instead of updating one
//   · a capacity or truck count that is legal but implausible
//   · a new client with no province, which reaches EMB as an incomplete record
export const HAULER_VERA_ASSESSMENT_PROMPT =
  "Assess this validated Accredited Haulers upload before I import it. " +
  "Summarize how many haulers are being added versus updated, and list any rows " +
  "that look risky — a hauler name that closely resembles an existing one but is " +
  "not identical (which would add a second hauler instead of updating it), a truck " +
  "capacity or truck count that looks implausible, a fleet count that disagrees " +
  "with the plate numbers supplied, or a new client with no province. " +
  "If everything looks consistent, say so briefly.";

const cell = (value) =>
  value === null || value === undefined || value === "" ? "—" : String(value);

const norm = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Hauler names in the FILE that closely resemble a name already on the baseline
 * without matching it.
 *
 * This is the failure this whole workflow is most exposed to: matching is by
 * name, so "XYZ Hauling" against a stored "XYZ Hauling Services" imports
 * cleanly, passes every validator, and silently produces two haulers. Nothing
 * about the row is invalid, so it can only ever be a judgement call — which is
 * exactly the kind of thing worth handing to VERA rather than hard-coding as a
 * blocking rule.
 *
 * Computed here rather than left for VERA to spot, so the finding does not
 * depend on the model noticing it in a 40-row sample.
 */
export function findSimilarHaulerNames(rows = [], existingHaulers = []) {
  const existing = (Array.isArray(existingHaulers) ? existingHaulers : [])
    .map((hauler) => String(hauler?.haulerName || hauler?.name || "").trim())
    .filter(Boolean);
  const existingKeys = new Set(existing.map(norm));

  const seen = new Set();
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const name = String(row?.haulerName || "").trim();
    const key = norm(name);
    if (!key || existingKeys.has(key) || seen.has(key)) return;
    // Only NEW names can be near-misses; a name that matched exactly is an
    // update and is not in question.
    const near = existing.find((candidate) => {
      const candidateKey = norm(candidate);
      if (candidateKey === key) return false;
      // One name contained in the other, both long enough that the overlap is
      // not a coincidence — "XYZ Hauling" vs "XYZ Hauling Services".
      return (
        (candidateKey.startsWith(`${key} `) ||
          key.startsWith(`${candidateKey} `)) &&
        Math.min(key.length, candidateKey.length) >= 6
      );
    });
    if (!near) return;
    seen.add(key);
    out.push({ uploaded: name, existing: near });
  });
  return out;
}

/**
 * Build the snapshot for a clean hauler preview.
 *
 * @param {Array}  rows      the annotated preview rows (post-validation)
 * @param {object} summary   summarizeHaulerUpload's counts
 * @param {Array}  existing  the haulers currently on the baseline
 */
export function buildHaulerVeraContext(
  rows = [],
  summary = null,
  existing = [],
) {
  const list = Array.isArray(rows) ? rows : [];
  const similar = findSimilarHaulerNames(list, existing);

  // Counted here so VERA can comment on the shape of the batch without having to
  // derive it from a truncated sample.
  const distinctHaulers = new Set(
    list.map((row) => norm(row?.haulerName)).filter(Boolean),
  );
  const clientRows = list.filter(
    (row) => (row?.privateSectorClients || []).length > 0,
  );
  const clientsWithoutProvince = clientRows.filter(
    (row) => !String(row?.clientProvince || "").trim(),
  );
  const totalClientNames = clientRows.reduce(
    (sum, row) => sum + (row.privateSectorClients || []).length,
    0,
  );
  const vehicleRows = list.filter((row) =>
    String(row?.plateNumber || "").trim(),
  );

  return {
    source: "page",
    // NOTE: matched against a blocklist for portal users
    // (admin|developer|settings|users|logs|backlogs|raw|database|security|
    // credentials|permissions|system). Keep them about haulers and clients.
    label: "Accredited Haulers — validated upload",
    inModal: true,
    modalTitle: "Preview Uploaded Data (Accredited Haulers)",
    filters: [],
    stats: [
      { label: "Rows validated", value: String(summary?.total ?? list.length) },
      { label: "Haulers to add", value: String(summary?.newHaulers ?? 0) },
      {
        label: "Haulers to update",
        value: String(summary?.updatedHaulers ?? 0),
      },
      {
        label: "Distinct haulers in file",
        value: String(distinctHaulers.size),
      },
      {
        label: "Rows carrying a plate number",
        value: String(vehicleRows.length),
      },
      { label: "Client names in file", value: String(totalClientNames) },
      {
        label: "Client rows with no province",
        value: String(clientsWithoutProvince.length),
      },
      {
        label: "Repeated rows to be merged",
        value: String(summary?.duplicates ?? 0),
      },
      {
        label: "Hauler names resembling an existing one",
        value: String(similar.length),
      },
      ...similar.slice(0, 5).map((pair) => ({
        label: `Uploaded "${pair.uploaded}" resembles stored`,
        value: pair.existing,
      })),
    ],
    tables: [
      {
        label: "Validated hauler rows",
        // 11 columns — inside the server's MAX_COLS of 12.
        columns: [
          "Line",
          "Action",
          "Hauler",
          "Trucks",
          "Plate",
          "Vehicle",
          "Capacity",
          "Unit",
          "Clients",
          "Client Type",
          "Province",
        ],
        rows: list
          .slice(0, HAULER_VERA_TABLE_ROW_CAP)
          .map((row) => [
            cell(row?._rowNumber),
            cell(row?._status),
            cell(row?.haulerName),
            cell(row?.numberOfTrucks),
            cell(row?.plateNumber),
            cell(row?.vehicleType),
            row?.capacity != null && row?.capacity !== ""
              ? String(row.capacity)
              : "—",
            cell(row?.capacityUnit),
            (row?.privateSectorClients || []).join(", ") || "—",
            cell(row?.clientType),
            cell(row?.clientProvince),
          ]),
        visibleRowCount: Math.min(list.length, HAULER_VERA_TABLE_ROW_CAP),
        // Becomes `totalRowCount` server-side, so VERA is told the batch is
        // larger than the sample it can see.
        truncated: list.length,
        empty: list.length === 0,
      },
    ],
  };
}

export default {
  buildHaulerVeraContext,
  findSimilarHaulerNames,
  HAULER_VERA_ASSESSMENT_PROMPT,
  HAULER_VERA_TABLE_ROW_CAP,
};
