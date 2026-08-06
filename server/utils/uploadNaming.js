/**
 * Display names for stored uploads, and the invariant that keeps a facility's
 * file URLs and their metadata in sync.
 *
 * ── Why uploaded files appeared with randomized names ───────────────────────
 * Google Drive itself is NOT the cause: createDriveFile sends the real
 * `originalname`, so the file in Drive is correctly named. The problem is on
 * the way back out.
 *
 * A stored URL is one of:
 *   /upload/secure/drive/<opaque drive id>?sig=…&name=<original>
 *   /upload/secure/local/<timestamp>-<random>.pdf.enc?sig=…&name=<original>
 *   /upload/files/<timestamp>-<random>.pdf
 *
 * Every name-derivation helper began with `url.split("?")[0]` — discarding the
 * `name` parameter that carries the original filename — and then returned the
 * last path segment. That segment is an opaque Drive id or a random storage
 * name, which is exactly the "randomized or unexpected filename" users saw.
 *
 * The second half of the problem is persistence: `preventiveMeasureFiles` (URLs)
 * and `preventiveMeasureFileDetails` (metadata) are parallel arrays that nothing
 * kept aligned. A write path that set the URLs without the details left the file
 * with no recorded name at all, so it fell back to the opaque URL forever.
 */

/** Read a query parameter without constructing a URL (paths may be relative). */
function queryParam(url, key) {
  const query = String(url || "").split("?")[1];
  if (!query) return "";
  for (const pair of query.split("&")) {
    const [name, value = ""] = pair.split("=");
    if (name === key) {
      try {
        return decodeURIComponent(value.replace(/\+/g, " "));
      } catch {
        return value;
      }
    }
  }
  return "";
}

/**
 * Best-known display name for a stored file URL.
 *
 * Order: the embedded `?name=` (written at upload time) → the local storage
 * file name with its `.enc` envelope stripped → the last path segment.
 */
function displayNameFromUrl(url, fallback = "document") {
  const embedded = queryParam(url, "name");
  if (embedded) return embedded;

  const path = String(url || "").split("?")[0].split("#")[0];
  let segment = path.split("/").pop() || "";
  try {
    segment = decodeURIComponent(segment);
  } catch {
    /* keep the raw segment */
  }
  segment = segment.replace(/\.enc$/i, "");
  return segment || fallback;
}

/**
 * Make a display name unique within a set, predictably.
 *
 * The file in Drive keeps its original name (Drive identifies by id, so
 * same-named files are safe there); only the DISPLAY/download name is
 * disambiguated, so a user downloading two files never has them collide and the
 * original name is still preserved wherever it can be.
 *
 *   report.pdf, report.pdf, report.pdf  ->  report.pdf, report (2).pdf, report (3).pdf
 */
function dedupeDisplayName(name, taken) {
  const clean = String(name || "document").trim() || "document";
  if (!taken.has(clean.toLowerCase())) {
    taken.add(clean.toLowerCase());
    return clean;
  }
  const dot = clean.lastIndexOf(".");
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : "";
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase());
      return candidate;
    }
  }
  // Pathological case only — keep it unique rather than silently colliding.
  const unique = `${stem} (${Date.now()})${ext}`;
  taken.add(unique.toLowerCase());
  return unique;
}

/**
 * Enforce the files ↔ details invariant for a facility's document arrays.
 *
 * • every URL gets exactly one detail row, in the same order
 * • an existing row's curated name/description/docType is preserved
 * • rows whose URL is no longer present are dropped (no orphans)
 * • display names are de-duplicated predictably
 *
 * @param {string[]} urls              the authoritative file list
 * @param {object[]} incomingDetails   details supplied by this request (may be partial)
 * @param {object[]} existingDetails   details currently stored on the record
 * @param {string}   defaultDocType
 * @returns {object[]} details aligned 1:1 with `urls`
 */
function syncFileDetails(urls, incomingDetails, existingDetails, defaultDocType = "Preventive Measures") {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
  const byUrl = new Map();
  for (const source of [existingDetails, incomingDetails]) {
    (Array.isArray(source) ? source : []).forEach((detail) => {
      if (detail?.url) byUrl.set(detail.url, { ...(byUrl.get(detail.url) || {}), ...detail });
    });
  }

  const taken = new Set();
  return list.map((url) => {
    const detail = byUrl.get(url) || {};
    const name = dedupeDisplayName(
      String(detail.fileName || "").trim() || displayNameFromUrl(url),
      taken,
    );
    return {
      url,
      fileName: name,
      description: String(detail.description || "").trim(),
      docType: String(detail.docType || "").trim() || defaultDocType,
    };
  });
}

module.exports = {
  displayNameFromUrl,
  dedupeDisplayName,
  syncFileDetails,
  queryParam,
};
