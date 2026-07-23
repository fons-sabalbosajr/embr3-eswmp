// Secure document text extraction for Prevention-Measures summaries.
//
// Fetches a stored document (Google Drive or local upload) by its URL, validates
// size + type + access, and extracts plain text from SUPPORTED formats only
// (.pdf / .docx / .txt). It NEVER guesses content: an unreadable, corrupt,
// password-protected, or unsupported file returns a warning and no text, so the
// caller can show a clear notice instead of a confident-but-wrong summary.
//
// Reuses the app's existing storage helpers:
//   • utils/googleDrive.js  — extractDriveFileId, getDriveClients (Drive bytes)
//   • utils/localUploadStorage.js — readLocalUpload (local bytes, incl. decrypt)

const path = require("path");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const { extractDriveFileId, getDriveClients } = require("./googleDrive");
const { readLocalUpload } = require("./localUploadStorage");

const MAX_BYTES = () => (Number(process.env.PREVENTION_DOC_MAX_MB) || 15) * 1024 * 1024;

const SUPPORTED_EXT = new Set([".pdf", ".docx", ".txt"]);

// Strip non-printable control characters but keep normal whitespace (\t \n \r).
// eslint-disable-next-line no-control-regex
const stripCtrl = (s) => String(s || "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

// Best-effort extension from a URL, a Drive file name, or a mime type.
function extOf({ url = "", name = "", mime = "" }) {
  const fromName = path.extname(String(name || "")).toLowerCase();
  if (SUPPORTED_EXT.has(fromName)) return fromName;
  const clean = String(url || "").split("?")[0].split("#")[0];
  const fromUrl = path.extname(decodeURIComponent(clean)).toLowerCase();
  if (SUPPORTED_EXT.has(fromUrl)) return fromUrl;
  const m = String(mime || "").toLowerCase();
  if (m.includes("pdf")) return ".pdf";
  if (m.includes("word") || m.includes("officedocument.wordprocessingml")) return ".docx";
  if (m.includes("text/plain")) return ".txt";
  return fromName || fromUrl || "";
}

// Map a stored URL to { kind, ref }. Drive wins when a Drive file id is present.
function classifyUrl(url) {
  const s = String(url || "").trim();
  if (!s) return { kind: "unknown" };
  const driveId = extractDriveFileId(s);
  if (driveId) return { kind: "drive", ref: driveId };
  // Local uploads are served at `${basePath}/upload/files/<fileName>`.
  const m = s.match(/\/upload\/files\/([^/?#]+)/);
  if (m) return { kind: "local", ref: decodeURIComponent(m[1]) };
  return { kind: "unknown" };
}

// Download raw bytes from Google Drive as a Buffer (no response streaming).
async function downloadDriveBuffer(fileId) {
  const clients = getDriveClients();
  let lastError;
  for (const client of clients) {
    try {
      const meta = await client.drive.files.get({ fileId, fields: "mimeType,name,size", supportsAllDrives: true });
      const resp = await client.drive.files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" }
      );
      const buffer = Buffer.from(resp.data);
      return {
        buffer,
        name: meta.data.name || "",
        mime: meta.data.mimeType || "",
        sizeBytes: Number(meta.data.size) || buffer.length,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Unable to download Drive file.");
}

// Fetch bytes + basic metadata for a stored document URL.
async function fetchDocument(url) {
  const { kind, ref } = classifyUrl(url);
  if (kind === "drive") {
    const d = await downloadDriveBuffer(ref);
    return { ...d, source: "drive" };
  }
  if (kind === "local") {
    const buffer = await readLocalUpload(ref);
    return { buffer, name: ref.replace(/\.enc$/i, ""), mime: "", sizeBytes: buffer.length, source: "local" };
  }
  const err = new Error("Unsupported or unrecognized document location.");
  err.code = "unsupported_location";
  throw err;
}

// Extract text from a supported buffer. Returns { text, confidence, warning }.
// confidence ∈ "high" | "low"; warning is a user-facing string when text can't be
// trusted (scanned image, empty, etc.). Throws for corrupt/encrypted files.
async function extractText({ buffer, ext }) {
  if (ext === ".txt") {
    const text = stripCtrl(buffer.toString("utf8")).trim();
    return { text, confidence: text.length > 20 ? "high" : "low", warning: text.length > 20 ? "" : "The document contained little or no readable text." };
  }
  if (ext === ".docx") {
    const { value } = await mammoth.extractRawText({ buffer });
    const text = stripCtrl(value).trim();
    return { text, confidence: text.length > 40 ? "high" : "low", warning: text.length > 40 ? "" : "Little readable text was found in this document." };
  }
  if (ext === ".pdf") {
    const data = await pdfParse(buffer);
    const text = stripCtrl(data.text).trim();
    const pages = data.numpages || 1;
    // A PDF that yields almost no text across multiple pages is very likely a
    // scanned image — flag low confidence rather than summarize nothing.
    const perPage = text.length / Math.max(pages, 1);
    const low = text.length < 40 || perPage < 20;
    return {
      text,
      confidence: low ? "low" : "high",
      warning: low ? "This PDF appears to be a scanned image — text could not be reliably extracted, so no summary was generated." : "",
      pages,
    };
  }
  const err = new Error("Unsupported file type.");
  err.code = "unsupported_type";
  throw err;
}

// Public: extract text from a stored document URL with full validation.
// Returns:
//   { ok: true, text, confidence, warning, meta:{ name, ext, sizeBytes, source } }
//   { ok: false, code, warning }   // never throws for expected failures
async function extractFromUrl(url) {
  let doc;
  try {
    doc = await fetchDocument(url);
  } catch (e) {
    if (e.code === "unsupported_location") {
      return { ok: false, code: "unsupported_location", warning: "This document is stored in a location the summarizer can't read." };
    }
    return { ok: false, code: "fetch_failed", warning: "The source document could not be retrieved. It may have been moved, deleted, or its access revoked." };
  }

  // Size guard (skip summarizing very large files).
  if (doc.sizeBytes && doc.sizeBytes > MAX_BYTES()) {
    return { ok: false, code: "too_large", warning: `The document exceeds the ${Math.round(MAX_BYTES() / 1024 / 1024)} MB limit for automatic summaries.` };
  }

  const ext = extOf({ url, name: doc.name, mime: doc.mime });
  if (!SUPPORTED_EXT.has(ext)) {
    return { ok: false, code: "unsupported_type", warning: "Only PDF, Word (.docx) and text files can be summarized. This file type is not supported." };
  }

  try {
    const { text, confidence, warning } = await extractText({ buffer: doc.buffer, ext });
    if (!text || confidence === "low") {
      return { ok: false, code: "low_confidence", warning: warning || "The document's text could not be read reliably.", meta: { name: doc.name, ext, sizeBytes: doc.sizeBytes, source: doc.source } };
    }
    return { ok: true, text, confidence, warning: warning || "", meta: { name: doc.name, ext, sizeBytes: doc.sizeBytes, source: doc.source } };
  } catch (e) {
    const msg = String(e?.message || "").toLowerCase();
    const encrypted = /password|encrypt/.test(msg);
    return {
      ok: false,
      code: encrypted ? "encrypted" : "corrupt",
      warning: encrypted
        ? "This document is password-protected and cannot be read for a summary."
        : "This document appears to be corrupted or unreadable, so no summary was generated.",
      meta: { name: doc.name, ext, sizeBytes: doc.sizeBytes, source: doc.source },
    };
  }
}

module.exports = { extractFromUrl, classifyUrl, extOf, SUPPORTED_EXT, MAX_BYTES };
