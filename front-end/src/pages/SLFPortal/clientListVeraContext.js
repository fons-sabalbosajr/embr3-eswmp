// What VERA is asked, and what it is shown, when a per-hauler client list
// previews cleanly.
//
// Same CONTRACT as bulkVeraContext.js / haulerVeraContext.js: `pageContext` is
// sanitized by server/utils/veraPageData.sanitizePageContext and filtered again
// for portal users by portalSafePageContext in routes/vera.js. Either can throw
// the whole snapshot away, after which VERA answers from its knowledge base
// about nothing in particular with no visible symptom — which is why the shape
// lives here, testable against the server's own sanitizer.
//
// Caps mirror the server's (MAX_ROWS 40, MAX_COLS 12, MAX_CELL 60).

export const CLIENT_VERA_TABLE_ROW_CAP = 40;

// Must satisfy server/utils/veraPageData.wantsPageData() — that gate decides
// whether the snapshot is spent on the prompt at all, so "summarize", "how
// many" and "list" are load-bearing.
//
// Pointed at what a client list gets wrong QUIETLY. The validator already
// blocks a missing name, a bad type and a new client with no province; these
// are the ones that import cleanly and are wrong anyway:
//   · a name that nearly matches an existing client — adds a duplicate client
//     instead of updating the one already there
//   · an LGU recorded as Private, or the reverse, which changes how the client
//     is counted in the Region 3 LGU-served figures
//   · a province that is not a Region 3 province, on a client expected to be
export const CLIENT_VERA_ASSESSMENT_PROMPT =
  "Assess this validated client list before I apply it to the hauler. " +
  "Summarize how many clients are being added versus updated, and list any rows " +
  "that look wrong — a client name that closely resembles one already on this " +
  "hauler but is not identical (which would add a duplicate instead of updating " +
  "it), a client whose name reads like a local government unit but is typed as " +
  "Private (or the reverse), an address whose province disagrees with the " +
  "Province column, or a province outside Central Luzon. " +
  "If everything looks consistent, say so briefly.";

const cell = (value) =>
  value === null || value === undefined || value === "" ? "—" : String(value);

const norm = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Uploaded client names that closely resemble one already on this hauler
 * without matching it.
 *
 * Same failure as the hauler-name near-miss, one level down: matching is by
 * name, so "ABC Manufacturing Inc" against a stored "ABC Manufacturing"
 * validates, applies, and leaves the hauler with two client records for one
 * company. Nothing about the row is invalid, so it can only ever be a judgement
 * call — computed here rather than left to the model to spot inside a sample.
 */
export function findSimilarClientNames(rows = [], existingClients = []) {
  const existing = (Array.isArray(existingClients) ? existingClients : [])
    .map((client) =>
      String(
        typeof client === "string" ? client : client?.clientName || client?.name || "",
      ).trim(),
    )
    .filter(Boolean);
  const existingKeys = new Set(existing.map(norm));

  const seen = new Set();
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const name = String(row?.clientName || "").trim();
    const key = norm(name);
    if (!key || existingKeys.has(key) || seen.has(key)) return;
    const near = existing.find((candidate) => {
      const candidateKey = norm(candidate);
      if (candidateKey === key) return false;
      return (
        (candidateKey.startsWith(`${key} `) || key.startsWith(`${candidateKey} `)) &&
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
 * Build the snapshot for a clean client-list preview.
 *
 * @param {Array}  rows     annotated preview rows
 * @param {object} summary  summarizeClientUpload's counts
 * @param {object} hauler   the hauler draft being edited
 */
export function buildClientListVeraContext(rows = [], summary = null, hauler = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const existingClients = Array.isArray(hauler?.privateSectorClients)
    ? hauler.privateSectorClients
    : [];
  const similar = findSimilarClientNames(list, existingClients);

  const lgu = list.filter((row) => String(row?.clientType || "") === "LGU").length;
  const provinces = new Set(
    list.map((row) => String(row?.provinceName || "").trim()).filter(Boolean),
  );
  const noProvince = list.filter((row) => !String(row?.provinceName || "").trim()).length;

  return {
    source: "page",
    // NOTE: matched against a blocklist for portal users
    // (admin|developer|settings|users|logs|backlogs|raw|database|security|
    // credentials|permissions|system). Keep them about haulers and clients.
    label: "Hauler client list — validated upload",
    inModal: true,
    modalTitle: "Upload Client List",
    filters: [],
    stats: [
      // The hauler is context VERA cannot get from the rows: there is no Hauler
      // Name column in this format, because the hauler is the modal you are in.
      { label: "Hauler being edited", value: String(hauler?.haulerName || "—") },
      { label: "Clients already on this hauler", value: String(existingClients.length) },
      { label: "Rows validated", value: String(summary?.total ?? list.length) },
      { label: "Clients to add", value: String(summary?.newClients ?? 0) },
      { label: "Clients to update", value: String(summary?.updatedClients ?? 0) },
      { label: "Repeated rows to be merged", value: String(summary?.duplicates ?? 0) },
      { label: "Rows typed as LGU", value: String(lgu) },
      { label: "Rows typed as Private", value: String(list.length - lgu) },
      { label: "Rows with no province", value: String(noProvince) },
      { label: "Distinct provinces in file", value: String(provinces.size) },
      { label: "Names resembling an existing client", value: String(similar.length) },
      ...similar.slice(0, 5).map((pair) => ({
        label: `Uploaded "${pair.uploaded}" resembles stored`,
        value: pair.existing,
      })),
    ],
    tables: [
      {
        label: "Validated client rows",
        // 8 columns — inside the server's MAX_COLS of 12.
        columns: [
          "Line", "Action", "Client", "Type",
          "Address", "Region", "Province", "City/Municipality",
        ],
        rows: list.slice(0, CLIENT_VERA_TABLE_ROW_CAP).map((row) => [
          cell(row?._rowNumber),
          cell(row?._status),
          cell(row?.clientName),
          cell(row?.clientType),
          cell(row?.clientAddress),
          cell(row?.regionName),
          cell(row?.provinceName),
          cell(row?.municipalityName),
        ]),
        visibleRowCount: Math.min(list.length, CLIENT_VERA_TABLE_ROW_CAP),
        truncated: list.length,
        empty: list.length === 0,
      },
    ],
  };
}

export default {
  buildClientListVeraContext,
  findSimilarClientNames,
  CLIENT_VERA_ASSESSMENT_PROMPT,
  CLIENT_VERA_TABLE_ROW_CAP,
};
