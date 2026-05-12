const express = require("express");
const multer = require("multer");
const { uploadFileToDrive } = require("../utils/googleDrive");
const { saveLocalUpload, resolveLocalUpload } = require("../utils/localUploadStorage");
const { authMiddleware } = require("../middleware/auth");

const router = express.Router();

router.get("/files/:fileName", (req, res) => {
  try {
    const filePath = resolveLocalUpload(req.params.fileName);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(filePath, (error) => {
      if (error && !res.headersSent) {
        res.status(error.statusCode === 404 ? 404 : 500).json({ message: "File not found" });
      }
    });
  } catch {
    res.status(400).json({ message: "Invalid file path" });
  }
});

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter(req, file, cb) {
    const allowed =
      file.mimetype.startsWith("image/") ||
      /^application\/(pdf|msword|vnd\.openxmlformats-officedocument\.(wordprocessingml|spreadsheetml|presentationml)\..+|vnd\.ms-excel|vnd\.ms-powerpoint)$/.test(
        file.mimetype
      ) ||
      file.mimetype === "text/plain";
    if (allowed) return cb(null, true);
    cb(new Error(`File type "${file.mimetype}" is not allowed.`));
  },
});

/**
 * POST /api/upload
 * Accepts a single file and uploads it to Google Drive.
 * Returns: { url, fileId, name, mimeType }
 */
router.post("/", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file provided." });
    }

    const isImage = req.file.mimetype.startsWith("image/");
    let fileId = "";
    let viewUrl = "";

    try {
      const driveResult = await uploadFileToDrive(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
        isImage
      );
      fileId = driveResult.fileId;
      viewUrl = driveResult.viewUrl;
    } catch (driveErr) {
      console.warn(`Drive upload failed; saving attachment locally instead: ${driveErr.message}`);
      const localResult = await saveLocalUpload(req.file);
      viewUrl = localResult.url;
    }

    res.json({
      url: viewUrl,
      fileId,
      name: req.file.originalname,
      mimeType: req.file.mimetype,
    });
  } catch (err) {
    const isConfigError =
      err.message.includes("not configured") ||
      err.message.includes("Missing env vars");
    res.status(isConfigError ? 503 : 500).json({ message: err.message });
  }
});

module.exports = router;
