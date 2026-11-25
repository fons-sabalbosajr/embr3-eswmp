// ── My Documents: every file a portal user has submitted ──
//
// Sources, all owned by the user's email:
//   • MOV (Means of Verification) on their baseline — per cell entry and per
//     baseline section (Active Cells / Closed Cells / Accredited Haulers). Every
//     submission keeps a SNAPSHOT of the baseline, so one MOV file appears in
//     many records; it is listed ONCE, with the Submission IDs it appears in.
//   • Letters of Intent sent with hauler deletion requests.
//   • Attachments the user put on their own support tickets and replies.
//
// Each document gets a stable id (a hash of its URL). The download route takes
// ids only and looks them up here again, so a client can never ask the server
// to fetch a URL of its own choosing.
const crypto = require("crypto");
const path = require("path");
const fs = require("fs/promises");
const DataSLF = require("../models/DataSLF");
const HaulerDeleteRequest = require("../models/HaulerDeleteRequest");
const SupportTicket = require("../models/SupportTicket");
const { extractDriveFileId } = require("./googleDrive");
const { resolveLocalUpload, isEncryptedUpload } = require("./localUploadStorage");

const MAX_TIME_MS = 20000;

const SECTION_LABELS = {
  activeCells: "Active Cells",
  closedCells: "Closed Cells",
  haulers: "Accredited Haulers",
};

const TYPE_LABELS = {
  mov: "MOV",
  letter: "Letter of Intent",
  attachment: "Support Attachment",
};

function documentId(url) {
  return crypto.createHash("sha256").update(String(url)).digest("hex").slice(0, 24);
}

/**
 * Where a document's bytes can be read from, or null when they cannot be
 * bundled (it is still listed, with its link). Only storage this app writes:
 *   • a Google Drive file (the download itself re-checks it is shared publicly);
 *   • a PUBLIC local upload (/upload/files/<name>). Encrypted admin media
 *     (/upload/secure/...) is never served to a portal user.
 */
function resolveDocumentSource(url, fileId) {
  const value = String(url || "").trim();
  const local = value.match(/\/upload\/files\/([^/?#]+)/);
  if (local) {
    let name;
    try {
      name = decodeURIComponent(local[1]);
    } catch {
      return null;
    }
    if (!name || isEncryptedUpload(name) || name.includes("/") || name.includes("\\")) return null;
    return { kind: "local", fileName: name };
  }
  if (/\/upload\/secure\//i.test(value)) return null;
  if (/^https:\/\/(drive|docs)\.google\.com\//i.test(value)) {
    const id = extractDriveFileId(value);
    if (id) return { kind: "drive", fileId: id };
  }
  const bareId = String(fileId || "").trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(bareId) && !value) return { kind: "drive", fileId: bareId };
  return null;
}

function fileNameFromUrl(url) {
  const local = String(url || "").match(/\/upload\/files\/([^/?#]+)/);
  if (!local) return "";
  try {
    // Local names are "<timestamp>-<random>.<ext>"; keep just the extension hint.
    return path.basename(decodeURIComponent(local[1]));
  } catch {
    return "";
  }
}

function toDate(value) {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

function newDocument({ url, fileId, type, section, cellName = "", fileName, mimeType, size, uploadedAt, slfName, reference = "" }) {
  const source = resolveDocumentSource(url, fileId);
  return {
    id: documentId(url || fileId),
    type,
    typeLabel: TYPE_LABELS[type],
    section,
    cellName,
    fileName: String(fileName || "").trim() || fileNameFromUrl(url) || "Untitled file",
    mimeType: String(mimeType || "").trim(),
    size: Number.isFinite(Number(size)) && Number(size) > 0 ? Number(size) : null,
    uploadedAt: toDate(uploadedAt),
    url: String(url || "").trim(),
    slfName: String(slfName || "").trim(),
    reference,
    submissionIds: [],
    downloadable: Boolean(source),
    source,
  };
}

/**
 * All documents for one portal user, newest first. Internal fields (`source`)
 * are included; strip them with `publicDocument` before sending to a client.
 */
async function collectPortalDocuments(email) {
  const owner = String(email || "").trim().toLowerCase();
  if (!owner) return [];
  const byId = new Map();

  const addMov = (attachment, { section, cellName, record }) => {
    const url = String(attachment?.url || "").trim();
    if (!url) return;
    const id = documentId(url);
    let doc = byId.get(id);
    if (!doc) {
      doc = newDocument({
        url,
        type: "mov",
        section,
        cellName,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        uploadedAt: attachment.uploadedAt || record.createdAt,
        slfName: record.slfName,
      });
      byId.set(id, doc);
    } else {
      const at = toDate(attachment.uploadedAt);
      if (at && (!doc.uploadedAt || at < doc.uploadedAt)) doc.uploadedAt = at;
      if (doc.fileName === "Untitled file" && attachment.fileName) doc.fileName = attachment.fileName;
    }
    // Only real submissions carry an ID worth filtering by; the baseline-only
    // container (no transport entries) is the Baseline itself.
    if (record.hasTrucks && record.idNo && !doc.submissionIds.includes(record.idNo)) {
      doc.submissionIds.push(record.idNo);
    }
  };

  const movRecords = DataSLF.aggregate([
    {
      $match: {
        submittedBy: { $in: [owner, email] },
        deletedAt: null,
        $or: [
          { "activeCellEntries.movAttachments.0": { $exists: true } },
          { "closedCellEntries.movAttachments.0": { $exists: true } },
          { "baselineMov.activeCells.0": { $exists: true } },
          { "baselineMov.closedCells.0": { $exists: true } },
          { "baselineMov.haulers.0": { $exists: true } },
        ],
      },
    },
    { $sort: { createdAt: 1 } },
    {
      $project: {
        idNo: 1,
        slfName: 1,
        createdAt: 1,
        hasTrucks: { $gt: [{ $size: { $ifNull: ["$trucks", []] } }, 0] },
        "activeCellEntries.cellName": 1,
        "activeCellEntries.movAttachments": 1,
        "closedCellEntries.cellName": 1,
        "closedCellEntries.movAttachments": 1,
        baselineMov: 1,
      },
    },
  ]).option({ maxTimeMS: MAX_TIME_MS });

  const [records, letters, tickets] = await Promise.all([
    movRecords,
    HaulerDeleteRequest.find({ portalUserEmail: { $in: [owner, email] }, letterOfIntentUrl: { $nin: [null, ""] } })
      .select("requestNo haulerName slfName letterOfIntentUrl letterOfIntentFileId letterOfIntentFileName createdAt")
      .sort({ createdAt: -1 })
      .maxTimeMS(MAX_TIME_MS)
      .lean(),
    SupportTicket.find({ portalUserEmail: { $in: [owner, email] } })
      .select("ticketNo subject slfName attachments createdAt replies.attachments replies.isAdmin replies.createdAt")
      .sort({ createdAt: -1 })
      .maxTimeMS(MAX_TIME_MS)
      .lean(),
  ]);

  for (const record of records) {
    for (const [list, closed] of [[record.activeCellEntries, false], [record.closedCellEntries, true]]) {
      for (const entry of Array.isArray(list) ? list : []) {
        for (const att of Array.isArray(entry?.movAttachments) ? entry.movAttachments : []) {
          addMov(att, {
            section: closed ? SECTION_LABELS.closedCells : SECTION_LABELS.activeCells,
            cellName: String(entry.cellName || "").trim(),
            record,
          });
        }
      }
    }
    for (const key of Object.keys(SECTION_LABELS)) {
      for (const att of Array.isArray(record.baselineMov?.[key]) ? record.baselineMov[key] : []) {
        addMov(att, { section: SECTION_LABELS[key], cellName: "", record });
      }
    }
  }

  for (const letter of letters) {
    const doc = newDocument({
      url: letter.letterOfIntentUrl,
      fileId: letter.letterOfIntentFileId,
      type: "letter",
      section: `Hauler deletion · ${letter.haulerName || "hauler"}`,
      fileName: letter.letterOfIntentFileName,
      uploadedAt: letter.createdAt,
      slfName: letter.slfName,
      reference: letter.requestNo || "",
    });
    if (!byId.has(doc.id)) byId.set(doc.id, doc);
  }

  for (const ticket of tickets) {
    const own = [
      ...(Array.isArray(ticket.attachments) ? ticket.attachments.map((a) => [a, ticket.createdAt]) : []),
      ...(Array.isArray(ticket.replies) ? ticket.replies : [])
        .filter((r) => r && !r.isAdmin)
        .flatMap((r) => (Array.isArray(r.attachments) ? r.attachments.map((a) => [a, r.createdAt]) : [])),
    ];
    for (const [att, at] of own) {
      const url = typeof att === "string" ? att : att?.url;
      if (!url && !att?.fileId) continue;
      const doc = newDocument({
        url,
        fileId: att?.fileId,
        type: "attachment",
        section: `Support ticket · ${ticket.subject || ticket.ticketNo || ""}`.trim(),
        fileName: att?.name || att?.fileName,
        mimeType: att?.mimeType,
        size: att?.size,
        uploadedAt: at,
        slfName: ticket.slfName,
        reference: ticket.ticketNo || "",
      });
      if (!byId.has(doc.id)) byId.set(doc.id, doc);
    }
  }

  return [...byId.values()].sort((a, b) => (b.uploadedAt?.getTime() || 0) - (a.uploadedAt?.getTime() || 0));
}

/** The client-facing view of a document (no storage internals). */
function publicDocument(doc) {
  const { source, ...rest } = doc;
  return rest;
}

// ── Zip bundling ──

const ZIP_MAX_FILES = 100;
const ZIP_MAX_FILE_BYTES = 50 * 1024 * 1024;
const ZIP_MAX_TOTAL_BYTES = 300 * 1024 * 1024;

function safeSegment(value, fallback = "file") {
  const cleaned = String(value || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

/** Folder + file name inside the zip, e.g. "MOV/Active Cells - Cell 2/report.pdf". */
function zipPathFor(doc) {
  const name = safeSegment(doc.fileName);
  if (doc.type === "mov") {
    const folder = doc.cellName ? `${doc.section} - ${doc.cellName}` : doc.section;
    return `MOV/${safeSegment(folder, "Baseline")}/${name}`;
  }
  const prefix = doc.reference ? `${safeSegment(doc.reference)} - ` : "";
  const folder = doc.type === "letter" ? "Letters of Intent" : "Support Attachments";
  return `${folder}/${prefix}${name}`;
}

/** Read one document's bytes. Throws with a short, user-facing message. */
async function readDocumentBytes(doc, { downloadDriveFile }) {
  const source = doc.source;
  if (!source) throw new Error("this file's storage location cannot be bundled");
  if (source.kind === "local") {
    const filePath = resolveLocalUpload(source.fileName);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) throw new Error("file not found on the server");
    if (stat.size > ZIP_MAX_FILE_BYTES) throw new Error("file is larger than 50 MB");
    return fs.readFile(filePath);
  }
  try {
    const { buffer } = await downloadDriveFile(source.fileId, { maxBytes: ZIP_MAX_FILE_BYTES });
    return buffer;
  } catch (err) {
    if (err?.code === "NOT_PUBLIC") throw new Error("file is not shared for download");
    if (err?.code === "TOO_LARGE") throw new Error("file is larger than 50 MB");
    throw new Error("file could not be read from Google Drive");
  }
}

module.exports = {
  collectPortalDocuments,
  publicDocument,
  resolveDocumentSource,
  documentId,
  zipPathFor,
  readDocumentBytes,
  safeSegment,
  ZIP_MAX_FILES,
  ZIP_MAX_FILE_BYTES,
  ZIP_MAX_TOTAL_BYTES,
};
