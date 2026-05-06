const express = require("express");
const multer = require("multer");
const HaulerDeleteRequest = require("../models/HaulerDeleteRequest");
const DataSLF = require("../models/DataSLF");
const Notification = require("../models/Notification");
const Transaction = require("../models/Transaction");
const { uploadFileToDrive } = require("../utils/googleDrive");
const { writeLog } = require("../utils/logger");
const { notifyAdmin, notifyPortal, refreshAdmin } = require("../utils/socketEmit");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter(req, file, cb) {
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "image/jpeg",
      "image/png",
    ];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error("Only PDF, DOC/DOCX, JPG, and PNG files are allowed."));
  },
});

// ── Portal: Submit hauler deletion request ──
router.post("/", upload.single("letterOfIntent"), async (req, res) => {
  try {
    const {
      portalUserEmail,
      portalUserName,
      companyName,
      slfName,
      haulerKey,
      haulerName,
      officeAddress,
      reason,
    } = req.body;

    if (!portalUserEmail || !haulerName || !reason) {
      return res.status(400).json({ message: "Email, hauler name, and reason are required." });
    }

    // Check for existing pending request for same hauler
    const existing = await HaulerDeleteRequest.findOne({
      portalUserEmail,
      haulerName,
      status: "pending",
    });
    if (existing) {
      return res.status(409).json({
        message: `A pending deletion request for "${haulerName}" already exists (${existing.requestNo}). Please wait for admin review.`,
      });
    }

    let letterOfIntentUrl = null;
    let letterOfIntentFileId = null;
    let letterOfIntentFileName = null;

    // Upload letter of intent to Google Drive if provided
    if (req.file) {
      const folderId = process.env.GDRIVE_HAULER_LOI_FOLDER_ID;
      if (!folderId) {
        return res.status(500).json({ message: "Hauler LOI Drive folder not configured." });
      }
      try {
        const driveResult = await uploadFileToDrive(
          req.file.buffer,
          req.file.mimetype,
          `LOI_${haulerName}_${Date.now()}_${req.file.originalname}`,
          false,
          folderId
        );
        letterOfIntentUrl = driveResult.viewUrl;
        letterOfIntentFileId = driveResult.fileId;
        letterOfIntentFileName = req.file.originalname;
      } catch (driveErr) {
        writeLog("error", "hauler_delete_request.drive_upload", {
          message: `Drive upload failed for ${portalUserEmail}: ${driveErr.message}`,
          user: portalUserEmail,
        });
        return res.status(502).json({ message: `File upload failed: ${driveErr.message}` });
      }
    }

    const request = new HaulerDeleteRequest({
      portalUserEmail,
      portalUserName,
      companyName,
      slfName,
      haulerKey,
      haulerName,
      officeAddress,
      reason,
      letterOfIntentUrl,
      letterOfIntentFileId,
      letterOfIntentFileName,
    });
    await request.save();

    // Notify admin
    try {
      await Notification.create({
        recipient: "admin",
        type: "hauler_delete_request",
        title: "New Hauler Deletion Request",
        message: `${portalUserName || portalUserEmail} requested deletion of hauler "${haulerName}" (${request.requestNo})`,
        meta: { requestNo: request.requestNo, haulerName, portalUserEmail },
      });
    } catch { /* silent */ }
    notifyAdmin(req, {
      type: "hauler_delete_request",
      title: "New Hauler Deletion Request",
      message: `${portalUserName || portalUserEmail} requested deletion of hauler "${haulerName}"`,
    });
    refreshAdmin(req, "hauler-requests");

    // Log transaction
    try {
      await Transaction.create({
        companyName: companyName || slfName || portalUserEmail,
        submissionId: request.requestNo,
        submittedBy: portalUserEmail,
        type: "hauler_delete_request",
        description: `Hauler deletion request ${request.requestNo} for "${haulerName}" submitted by ${portalUserEmail}`,
        performedBy: portalUserEmail,
        meta: { requestNo: request.requestNo, haulerName },
      });
    } catch { /* silent */ }

    writeLog("info", "hauler_delete_request.create", {
      message: `Hauler deletion request ${request.requestNo} created by ${portalUserEmail}`,
      user: portalUserEmail,
      meta: { requestNo: request.requestNo, haulerName },
    });

    res.status(201).json({ message: "Deletion request submitted successfully.", data: request });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ── Portal: Get my hauler deletion requests ──
router.get("/my-requests/:email", async (req, res) => {
  try {
    const requests = await HaulerDeleteRequest.find({ portalUserEmail: req.params.email })
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ── Admin: Get all pending/all hauler deletion requests ──
router.get("/", async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status && status !== "all") filter.status = status;
    if (search) {
      filter.$or = [
        { haulerName: { $regex: search, $options: "i" } },
        { portalUserEmail: { $regex: search, $options: "i" } },
        { companyName: { $regex: search, $options: "i" } },
        { requestNo: { $regex: search, $options: "i" } },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [requests, total] = await Promise.all([
      HaulerDeleteRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      HaulerDeleteRequest.countDocuments(filter),
    ]);
    res.json({ requests, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ── Admin: Approve hauler deletion request ──
router.patch("/:id/approve", async (req, res) => {
  try {
    const { adminName, adminEmail, remarks, adminRemarks } = req.body;
    const request = await HaulerDeleteRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: "Request not found." });
    if (request.status !== "pending") {
      return res.status(400).json({ message: `Request is already ${request.status}.` });
    }

    request.status = "approved";
    request.reviewedBy = adminName || adminEmail || "admin";
    request.reviewedAt = new Date();
    request.adminRemarks = remarks || adminRemarks || "";
    await request.save();

    // Remove hauler from baseline data
    if (request.slfName || request.companyName) {
      try {
        const slfFilter = {
          deletedAt: null,
          $or: [
            request.slfName && { slfName: request.slfName },
            request.slfName && { lguCompanyName: request.slfName },
            request.companyName && { lguCompanyName: request.companyName },
          ].filter(Boolean),
        };
        const pullByKey = request.haulerKey
          ? DataSLF.updateMany(slfFilter, { $pull: { accreditedHaulers: { key: request.haulerKey } } })
          : Promise.resolve({ modifiedCount: 0 });
        const pullByName = DataSLF.updateMany(slfFilter, { $pull: { accreditedHaulers: { haulerName: request.haulerName } } });
        await Promise.all([pullByKey, pullByName]);
      } catch (e) {
        writeLog("warn", "hauler_delete_request.remove_hauler", {
          message: `Could not remove hauler from DataSLF: ${e.message}`,
          meta: { requestNo: request.requestNo },
        });
      }
    }

    // Notify portal user
    try {
      await Notification.create({
        recipient: request.portalUserEmail,
        type: "hauler_delete_approved",
        title: "Hauler Deletion Request Approved",
        message: `Your request to delete hauler "${request.haulerName}" (${request.requestNo}) has been approved.`,
        meta: { requestNo: request.requestNo, haulerName: request.haulerName },
      });
    } catch { /* silent */ }
    notifyPortal(req, request.portalUserEmail, {
      type: "hauler_delete_approved",
      title: "Hauler Deletion Request Approved",
      message: `Your request to delete hauler "${request.haulerName}" has been approved.`,
    });

    // Log transaction
    try {
      await Transaction.create({
        companyName: request.companyName || request.slfName || request.portalUserEmail,
        submissionId: request.requestNo,
        submittedBy: request.portalUserEmail,
        type: "hauler_delete_approved",
        description: `Hauler deletion request ${request.requestNo} approved by ${request.reviewedBy}`,
        performedBy: request.reviewedBy,
        meta: { requestNo: request.requestNo, haulerName: request.haulerName },
      });
    } catch { /* silent */ }

    writeLog("info", "hauler_delete_request.approved", {
      message: `Hauler deletion request ${request.requestNo} approved by ${request.reviewedBy}`,
      user: adminEmail,
    });

    res.json({ message: "Request approved and hauler removed.", data: request });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ── Admin: Reject hauler deletion request ──
router.patch("/:id/reject", async (req, res) => {
  try {
    const { adminName, adminEmail, remarks, adminRemarks } = req.body;
    const request = await HaulerDeleteRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: "Request not found." });
    if (request.status !== "pending") {
      return res.status(400).json({ message: `Request is already ${request.status}.` });
    }

    request.status = "rejected";
    request.reviewedBy = adminName || adminEmail || "admin";
    request.reviewedAt = new Date();
    request.adminRemarks = remarks || adminRemarks || "";
    await request.save();

    // Notify portal user
    try {
      await Notification.create({
        recipient: request.portalUserEmail,
        type: "hauler_delete_rejected",
        title: "Hauler Deletion Request Rejected",
        message: `Your request to delete hauler "${request.haulerName}" (${request.requestNo}) was rejected. ${request.adminRemarks ? `Remarks: ${request.adminRemarks}` : ""}`,
        meta: { requestNo: request.requestNo, haulerName: request.haulerName },
      });
    } catch { /* silent */ }
    notifyPortal(req, request.portalUserEmail, {
      type: "hauler_delete_rejected",
      title: "Hauler Deletion Request Rejected",
      message: `Your request to delete hauler "${request.haulerName}" was rejected.`,
    });

    // Log transaction
    try {
      await Transaction.create({
        companyName: request.companyName || request.slfName || request.portalUserEmail,
        submissionId: request.requestNo,
        submittedBy: request.portalUserEmail,
        type: "hauler_delete_rejected",
        description: `Hauler deletion request ${request.requestNo} rejected by ${request.reviewedBy}`,
        performedBy: request.reviewedBy,
        meta: { requestNo: request.requestNo, haulerName: request.haulerName },
      });
    } catch { /* silent */ }

    writeLog("info", "hauler_delete_request.rejected", {
      message: `Hauler deletion request ${request.requestNo} rejected by ${request.reviewedBy}`,
      user: adminEmail,
    });

    res.json({ message: "Request rejected.", data: request });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

module.exports = router;
