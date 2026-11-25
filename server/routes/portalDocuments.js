// ── /api/portal-documents — the portal's My Documents menu ──
//
//   GET  /            every file the signed-in portal user has submitted
//   POST /download    { ids: [...] } → one .zip of the chosen files
//
// The download takes document IDS, never URLs: the list is rebuilt from the
// user's own records on every request and only files found there are bundled.
const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAnyAuth } = require("../middleware/auth");
const { resolvePortalContext, sendPortalContextError } = require("../utils/portalContext");
const { writeLog } = require("../utils/logger");
const { ZipStream } = require("../utils/zipStream");
const googleDrive = require("../utils/googleDrive");
const {
  collectPortalDocuments,
  publicDocument,
  zipPathFor,
  readDocumentBytes,
  safeSegment,
  ZIP_MAX_FILES,
  ZIP_MAX_TOTAL_BYTES,
} = require("../utils/portalDocuments");

const router = express.Router();
router.use(requireAnyAuth);

// Each bundle can pull up to 100 files from Google Drive, so bursts are capped
// per user (falling back to IP) on top of the global portal limits.
const { ipKeyGenerator } = rateLimit;
const downloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.PORTAL_DOCUMENT_ZIP_RATE_MAX ?? 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many downloads in a short time. Please wait a few minutes and try again." },
  keyGenerator: (req) =>
    req.user?.email || req.user?.id || ipKeyGenerator(req.ip || req.socket?.remoteAddress || "unknown"),
});

const contextFor = (req) =>
  resolvePortalContext(req, {
    targetEmail: req.query.email || req.body?.email,
    targetPortalUserId: req.query.targetPortalUserId || req.body?.targetPortalUserId,
  });

router.get("/", async (req, res) => {
  try {
    const ctx = await contextFor(req);
    const documents = await collectPortalDocuments(ctx.email);
    const counts = documents.reduce(
      (acc, doc) => {
        acc.all += 1;
        acc[doc.type] = (acc[doc.type] || 0) + 1;
        return acc;
      },
      { all: 0, mov: 0, letter: 0, attachment: 0 },
    );
    res.json({ documents: documents.map(publicDocument), counts });
  } catch (error) {
    return sendPortalContextError(res, error);
  }
});

router.post("/download", downloadLimiter, async (req, res) => {
  let ctx;
  let selected;
  try {
    ctx = await contextFor(req);
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String))];
    if (ids.length === 0) return res.status(400).json({ message: "Choose at least one file to download." });
    if (ids.length > ZIP_MAX_FILES) {
      return res.status(400).json({ message: `You can download up to ${ZIP_MAX_FILES} files at a time.` });
    }
    const documents = await collectPortalDocuments(ctx.email);
    const byId = new Map(documents.map((doc) => [doc.id, doc]));
    selected = ids.map((id) => byId.get(id)).filter(Boolean);
    if (selected.length === 0) {
      return res.status(404).json({ message: "None of the chosen files were found in your documents." });
    }
  } catch (error) {
    return sendPortalContextError(res, error);
  }

  const facility = safeSegment(selected[0]?.slfName || "SLF", "SLF");
  const day = new Date().toISOString().slice(0, 10);
  const zipName = `My Documents - ${facility} - ${day}.zip`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${zipName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'")}"; filename*=UTF-8''${encodeURIComponent(zipName)}`,
  );
  res.setHeader("Cache-Control", "no-store");

  // Files are added one at a time and a file that cannot be read is skipped,
  // not fatal: the bundle still downloads, with a note naming what is missing.
  const zip = new ZipStream(res);
  const skipped = [];
  let total = 0;
  let added = 0;
  try {
    for (const doc of selected) {
      if (res.destroyed) break;
      let bytes;
      try {
        // eslint-disable-next-line no-await-in-loop -- one file in memory at a time
        bytes = await readDocumentBytes(doc, { downloadDriveFile: googleDrive.downloadDriveFile });
      } catch (err) {
        skipped.push(`${doc.fileName} — ${err.message}`);
        continue;
      }
      if (total + bytes.length > ZIP_MAX_TOTAL_BYTES) {
        skipped.push(`${doc.fileName} — the bundle reached its 300 MB limit; download it separately`);
        continue;
      }
      total += bytes.length;
      // eslint-disable-next-line no-await-in-loop
      await zip.addFile(zipPathFor(doc), bytes, doc.uploadedAt || new Date());
      added += 1;
    }
    if (skipped.length) {
      const note = [
        "Some of the files you chose could not be included in this download:",
        "",
        ...skipped.map((line) => `  - ${line}`),
        "",
        "You can still open each of them from My Documents in the SLF Portal.",
      ].join("\r\n");
      await zip.addFile("Files not included.txt", Buffer.from(note, "utf8"));
    }
    await zip.finalize();
    writeLog("info", "portal.documents.download", {
      message: `My Documents bundle downloaded (${added} file(s))`,
      user: ctx.email,
      ip: req.ip,
      meta: { requested: selected.length, added, skipped: skipped.length, bytes: total },
    });
  } catch (error) {
    writeLog("error", "portal.documents.download_failed", {
      message: `My Documents bundle failed: ${error.message}`,
      user: ctx?.email,
      ip: req.ip,
      meta: { requested: selected.length, added },
    });
    // Headers are already sent; ending the stream early leaves an incomplete
    // file, which the browser reports as a failed download.
    res.destroy(error);
  }
});

module.exports = router;
