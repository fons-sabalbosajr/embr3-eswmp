const express = require("express");
const multer = require("multer");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const SlfFacility = require("../models/SlfFacility");
const { authMiddleware, adminOnly } = require("../middleware/auth");
const { writeLog } = require("../utils/logger");
const { validateDriveFile, extractDriveFileId, uploadFilePathToDrive } = require("../utils/googleDrive");
const { saveLocalUpload } = require("../utils/localUploadStorage");
const { uploadSingle } = require("../utils/uploadErrorHandler");

const router = express.Router();

router.use(authMiddleware, adminOnly);

const MAX_REPLACE_MB = 200;
const REPLACE_TMP_DIR = process.env.UPLOAD_TMP_DIR || path.join(os.tmpdir(), "embr3-eswmp-uploads");
const replaceUpload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try {
        await fs.mkdir(REPLACE_TMP_DIR, { recursive: true });
        cb(null, REPLACE_TMP_DIR);
      } catch (error) {
        cb(error);
      }
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 12);
      cb(null, `${Date.now()}-${crypto.randomBytes(16).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: MAX_REPLACE_MB * 1024 * 1024 },
});

const facilityLabel = (f) =>
  `${f.lgu || f.province || "Unknown"}${f.ownership ? ` (${f.ownership})` : ""}`;

// Flatten the various file-bearing fields on an SlfFacility document into a
// normalized list of file descriptors linked back to the SLF record.
function collectFiles(facility) {
  const files = [];
  const push = (url, { title, source, docType, caption } = {}) => {
    if (!url || typeof url !== "string") return;
    files.push({
      facilityId: facility._id,
      facilityName: facilityLabel(facility),
      province: facility.province || "",
      dataYear: facility.dataYear || null,
      url,
      title: title || caption || "",
      source,
      docType: docType || "",
      driveFileId: extractDriveFileId(url),
      storage: extractDriveFileId(url) ? "drive" : "local",
    });
  };

  (facility.slfDocuments || []).forEach((d) =>
    push(d?.url, { title: d?.title, source: "Documents", docType: d?.docType })
  );
  (facility.galleryItems || []).forEach((g) =>
    push(g?.url, { caption: g?.caption, source: g?.component || "Gallery", docType: "image" })
  );
  (facility.galleryPhotos || []).forEach((url) =>
    push(url, { source: "Gallery", docType: "image" })
  );

  const flatArrays = [
    ["commitmentFiles", "Commitment Files"],
    ["progressReportFiles", "Progress Reports"],
    ["preventiveMeasureFiles", "Preventive Measures"],
  ];
  flatArrays.forEach(([key, source]) =>
    (facility[key] || []).forEach((url) => push(url, { source }))
  );

  const nestedArrays = [
    ["leachatePondDetails", "Leachate Pond"],
    ["gasVentDetails", "Gas Vent"],
    ["trashSlideMeasures", "Trash Slide Measures"],
    ["firePrevMeasures", "Fire Prevention"],
    ["scrpDetails", "Closure Plan"],
  ];
  nestedArrays.forEach(([key, source]) =>
    (facility[key] || []).forEach((item) =>
      (item?.attachments || []).forEach((url) => push(url, { source }))
    )
  );

  return files;
}

// List files linked to SLF Data Table records. Optionally scope to one facility.
router.get("/", async (req, res) => {
  try {
    const filter = { deletedAt: null };
    if (req.query.facilityId) filter._id = req.query.facilityId;
    if (req.query.includeDummy !== "true") filter.isDummy = { $ne: true };

    const facilities = await SlfFacility.find(filter)
      .select(
        "lgu province ownership dataYear isDummy slfDocuments galleryItems galleryPhotos " +
          "commitmentFiles progressReportFiles preventiveMeasureFiles leachatePondDetails " +
          "gasVentDetails trashSlideMeasures firePrevMeasures scrpDetails"
      )
      .sort({ province: 1, lgu: 1 });

    const files = [];
    facilities.forEach((f) => files.push(...collectFiles(f)));
    res.json({ total: files.length, files });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Validate a single file's accessibility on Google Drive. Never crashes the UI —
// returns a readable reason/message when the file is missing or restricted.
router.get("/validate", async (req, res) => {
  try {
    const { url, fileId, facilityId } = req.query;
    const target = url || fileId;
    if (!target) {
      return res.status(400).json({ message: "A file url or fileId is required." });
    }

    // Optional: confirm the file is actually linked to the record.
    if (facilityId) {
      const facility = await SlfFacility.findById(facilityId).select(
        "lgu province ownership dataYear isDummy slfDocuments galleryItems galleryPhotos " +
          "commitmentFiles progressReportFiles preventiveMeasureFiles leachatePondDetails " +
          "gasVentDetails trashSlideMeasures firePrevMeasures scrpDetails"
      );
      if (!facility) {
        return res.json({
          accessible: false,
          reason: "record_missing",
          message: "The linked SLF record no longer exists.",
        });
      }
      const linked = collectFiles(facility).some((f) => f.url === url || f.driveFileId === fileId);
      if (!linked && url) {
        return res.json({
          accessible: false,
          reason: "not_linked",
          message: "The SLF record exists, but this file is no longer attached to it.",
        });
      }
    }

    const result = await validateDriveFile(target);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      accessible: false,
      reason: "server_error",
      message: `Could not validate file: ${error.message}`,
    });
  }
});

// Remove a file reference from an SLF record. Pulls the URL out of every
// file-bearing array. Does NOT delete the underlying Drive object (kept for
// audit/recovery); the reference is simply unlinked from the record.
router.delete("/", async (req, res) => {
  try {
    const { facilityId, url } = req.body || {};
    if (!facilityId || !url) {
      return res.status(400).json({ message: "facilityId and url are required." });
    }
    const facility = await SlfFacility.findById(facilityId);
    if (!facility) return res.status(404).json({ message: "SLF record not found." });

    let removed = 0;
    const pullFlat = (key) => {
      if (!Array.isArray(facility[key])) return;
      const before = facility[key].length;
      facility[key] = facility[key].filter((u) => u !== url);
      removed += before - facility[key].length;
    };
    ["galleryPhotos", "commitmentFiles", "progressReportFiles", "preventiveMeasureFiles"].forEach(
      pullFlat
    );

    if (Array.isArray(facility.slfDocuments)) {
      const before = facility.slfDocuments.length;
      facility.slfDocuments = facility.slfDocuments.filter((d) => d?.url !== url);
      removed += before - facility.slfDocuments.length;
    }
    if (Array.isArray(facility.galleryItems)) {
      const before = facility.galleryItems.length;
      facility.galleryItems = facility.galleryItems.filter((g) => g?.url !== url);
      removed += before - facility.galleryItems.length;
    }
    ["leachatePondDetails", "gasVentDetails", "trashSlideMeasures", "firePrevMeasures", "scrpDetails"].forEach(
      (key) => {
        if (!Array.isArray(facility[key])) return;
        facility[key].forEach((item) => {
          if (Array.isArray(item?.attachments)) {
            const before = item.attachments.length;
            item.attachments = item.attachments.filter((u) => u !== url);
            removed += before - item.attachments.length;
          }
        });
      }
    );

    if (removed === 0) {
      return res.status(404).json({ message: "File reference not found on this SLF record." });
    }
    await facility.save();
    res.json({ message: `Removed ${removed} file reference(s) from the SLF record.` });
    writeLog("warn", "slf-data-files.delete", {
      message: `Unlinked file from SLF ${facilityLabel(facility)}: ${url}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Replace every occurrence of oldUrl on a facility with newUrl (in place).
function swapUrlInFacility(facility, oldUrl, newUrl) {
  let count = 0;
  const swapFlat = (key) => {
    if (!Array.isArray(facility[key])) return;
    facility[key] = facility[key].map((u) => {
      if (u === oldUrl) { count += 1; return newUrl; }
      return u;
    });
  };
  ["galleryPhotos", "commitmentFiles", "progressReportFiles", "preventiveMeasureFiles"].forEach(swapFlat);

  (facility.slfDocuments || []).forEach((d) => { if (d?.url === oldUrl) { d.url = newUrl; count += 1; } });
  (facility.galleryItems || []).forEach((g) => { if (g?.url === oldUrl) { g.url = newUrl; count += 1; } });
  ["leachatePondDetails", "gasVentDetails", "trashSlideMeasures", "firePrevMeasures", "scrpDetails"].forEach((key) => {
    (facility[key] || []).forEach((item) => {
      if (Array.isArray(item?.attachments)) {
        item.attachments = item.attachments.map((u) => {
          if (u === oldUrl) { count += 1; return newUrl; }
          return u;
        });
      }
    });
  });
  facility.markModified("slfDocuments");
  facility.markModified("galleryItems");
  return count;
}

// Verify access for many files at once. Bounded to avoid heavy Drive load.
router.post("/verify-all", async (req, res) => {
  try {
    const files = Array.isArray(req.body?.files) ? req.body.files.slice(0, 60) : [];
    if (files.length === 0) return res.status(400).json({ message: "No files provided." });
    const results = [];
    for (const f of files) {
      const target = f?.url || f?.fileId;
      if (!target) {
        results.push({ url: f?.url || "", accessible: false, reason: "missing", message: "No file reference." });
        continue;
      }
      const status = await validateDriveFile(target);
      results.push({ url: f.url, facilityId: f.facilityId, ...status });
    }
    writeLog("info", "slf-data-files.verify-all", {
      message: `Verified access for ${results.length} SLF file(s)`,
      user: req.user?.email || req.user?.id || "",
      ip: req.ip,
      meta: { total: results.length, inaccessible: results.filter((r) => !r.accessible).length },
    });
    res.json({ total: results.length, results });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Mark a file as legacy/inaccessible: unlink the active reference but preserve
// the old metadata in the audit log for future recovery attempts.
router.post("/mark-legacy", async (req, res) => {
  try {
    const { facilityId, url, reason } = req.body || {};
    if (!facilityId || !url) return res.status(400).json({ message: "facilityId and url are required." });
    const facility = await SlfFacility.findById(facilityId);
    if (!facility) return res.status(404).json({ message: "SLF record not found." });

    const removed = swapUrlInFacility(facility, url, undefined);
    // Drop the now-undefined entries from flat arrays.
    ["galleryPhotos", "commitmentFiles", "progressReportFiles", "preventiveMeasureFiles"].forEach((key) => {
      if (Array.isArray(facility[key])) facility[key] = facility[key].filter(Boolean);
    });
    if (Array.isArray(facility.slfDocuments)) facility.slfDocuments = facility.slfDocuments.filter((d) => d?.url);
    if (Array.isArray(facility.galleryItems)) facility.galleryItems = facility.galleryItems.filter((g) => g?.url);
    ["leachatePondDetails", "gasVentDetails", "trashSlideMeasures", "firePrevMeasures", "scrpDetails"].forEach((key) => {
      (facility[key] || []).forEach((item) => {
        if (Array.isArray(item?.attachments)) item.attachments = item.attachments.filter(Boolean);
      });
    });
    if (removed === 0) return res.status(404).json({ message: "File reference not found on this SLF record." });
    await facility.save();

    writeLog("warn", "slf-data-files.mark-legacy", {
      message: `Marked file as legacy/inaccessible on SLF ${facilityLabel(facility)}`,
      user: req.user?.email || req.user?.id || "",
      ip: req.ip,
      meta: { facilityId, oldUrl: url, oldFileId: extractDriveFileId(url), reason: reason || "inaccessible" },
    });
    res.json({ message: "File marked as legacy/inaccessible and unlinked. Old metadata saved to audit logs." });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Replace an inaccessible file with a freshly-uploaded file on the NEW Drive
// account and relink the SLF record. Old metadata is preserved in the audit log.
router.post("/replace", uploadSingle(replaceUpload, "file", { maxSizeMb: MAX_REPLACE_MB }), async (req, res) => {
  try {
    const { facilityId, oldUrl } = req.body || {};
    if (!facilityId || !oldUrl) return res.status(400).json({ message: "facilityId and oldUrl are required." });
    if (!req.file) return res.status(400).json({ message: "A replacement file is required." });

    const facility = await SlfFacility.findById(facilityId);
    if (!facility) return res.status(404).json({ message: "SLF record not found." });

    const isImage = (req.file.mimetype || "").startsWith("image/");
    let newUrl = "";
    let storage = "drive";
    try {
      const result = await uploadFilePathToDrive(req.file.path, req.file.mimetype, req.file.originalname, isImage);
      newUrl = result.viewUrl;
    } catch (driveErr) {
      // Fall back to local storage so the repair can still proceed.
      const local = await saveLocalUpload(req.file);
      newUrl = local.url;
      storage = "local";
      writeLog("warn", "slf-data-files.replace.local-fallback", {
        message: `Drive unavailable — replacement stored locally: ${driveErr.message}`,
        user: req.user?.email || req.user?.id || "", ip: req.ip,
      });
    }

    const swapped = swapUrlInFacility(facility, oldUrl, newUrl);
    if (swapped === 0) {
      return res.status(404).json({ message: "Old file reference not found on this SLF record." });
    }
    await facility.save();

    writeLog("info", "slf-data-files.replace", {
      message: `Replaced file on SLF ${facilityLabel(facility)}`,
      user: req.user?.email || req.user?.id || "",
      ip: req.ip,
      meta: {
        facilityId,
        oldUrl,
        oldFileId: extractDriveFileId(oldUrl),
        newFileId: extractDriveFileId(newUrl),
        storage,
        fileName: req.file.originalname,
      },
    });
    res.json({ message: "File replaced and SLF record relinked.", url: newUrl, storage });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  } finally {
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
  }
});

module.exports = router;
