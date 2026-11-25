// ── My Documents: list filtering (pure, unit-tested) ──
//
// Documents come from GET /portal-documents. Each has:
//   { id, type: "mov"|"letter"|"attachment", typeLabel, section, cellName,
//     fileName, mimeType, size, uploadedAt, url, slfName, reference,
//     submissionIds: [], downloadable }

export const DOCUMENT_TYPES = [
  { value: "all", label: "All" },
  { value: "mov", label: "MOV" },
  { value: "letter", label: "Letters" },
  { value: "attachment", label: "Attachments" },
];

// The value of the "Cell / section" filter for one document.
export function placeKey(doc) {
  return doc.cellName ? `${doc.section} · ${doc.cellName}` : doc.section || "";
}

/** Distinct cell / section choices, for the filter dropdown (MOVs first). */
export function placeOptions(documents) {
  const seen = new Map();
  for (const doc of documents || []) {
    const key = placeKey(doc);
    if (key && !seen.has(key)) seen.set(key, doc.type === "mov" ? 0 : 1);
  }
  return [...seen.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([key]) => ({ value: key, label: key }));
}

/**
 * Apply the panel's filters.
 * @param {object[]} documents
 * @param {{ type?: string, place?: string, search?: string }} filters
 *   search matches file name, Submission ID, request/ticket number and section.
 */
export function filterDocuments(documents, { type = "all", place = "", search = "" } = {}) {
  const needle = String(search || "").trim().toLowerCase();
  return (documents || []).filter((doc) => {
    if (type !== "all" && doc.type !== type) return false;
    if (place && placeKey(doc) !== place) return false;
    if (!needle) return true;
    const haystack = [
      doc.fileName,
      doc.section,
      doc.cellName,
      doc.reference,
      ...(doc.submissionIds || []),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

/** Count per type, for the filter labels. */
export function countByType(documents) {
  const counts = { all: 0, mov: 0, letter: 0, attachment: 0 };
  for (const doc of documents || []) {
    counts.all += 1;
    if (doc.type in counts) counts[doc.type] += 1;
  }
  return counts;
}

/** File name from a Content-Disposition header (RFC 6266 filename* first). */
export function fileNameFromDisposition(header, fallback = "My Documents.zip") {
  const value = String(header || "");
  const star = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* fall through */
    }
  }
  const plain = value.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() : fallback;
}

export function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
