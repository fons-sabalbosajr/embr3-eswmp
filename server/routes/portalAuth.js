const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const multer = require("multer");
const AppSettings = require("../models/AppSettings");
const UserPortal = require("../models/UserPortal");
const { writeLog } = require("../utils/logger");
const serverCache = require("../utils/serverCache");
const keys = require("../utils/cacheKeys");
const {
  resolveCellName,
  applyResolvedCellNames,
  applyResolvedCellNamesToAll,
} = require("../utils/cellNaming");
const { uploadFileToDrive } = require("../utils/googleDrive");
const {
  saveVerificationFile,
  resolveVerificationFile,
} = require("../utils/verificationFileStorage");
const { uploadSingle } = require("../utils/uploadErrorHandler");
const {
  sendPortalSignupEmail,
  sendPortalResetPasswordEmail,
  sendPortalCustomEmail,
  isEmailDeliverable,
} = require("../utils/email");
const { notifyAdmin } = require("../utils/socketEmit");
// Report arithmetic lives outside the route: the route's job is identity, the
// module's is aggregation, and the latter is then testable without a database.
const { buildPortalReport } = require("../utils/portalReport");
const { RESUBMISSION_FIELDS, resubmissionSummary } = require("../utils/resubmission");
const Notification = require("../models/Notification");
const {
  resolvePortalContext,
  assertPortalWriteAllowed,
  sendPortalContextError,
} = require("../utils/portalContext");

const router = express.Router();

// ── Projections for the portal Submission History payload ───────────────────
//
// The history view reads identity, status, location and the per-truck detail it
// expands into rows. It does NOT read the baseline sub-documents
// (accreditedHaulers / activeCellEntries / closedCellEntries / totalVolumeAccepted…)
// — those come from GET /data-slf/baseline/:slfName — so shipping them here was
// pure waste, as was inlining the entire SlfFacility document into every row.
// LIST projection. `trucks` is pulled down to its CELL-PLACEMENT sub-paths only —
// enough to derive the "Cell Assigned" column and the unplaced-placement flag
// server-side — and is then stripped from the response entirely. The full
// trucks[] (with nested vehicles[] and their selectedClients[]) was 83% of this
// payload: 300 KB of 363 KB for one user, and the list never rendered any of it.
//
// Anything needing the whole record (Edit & Resubmit, the cell organizer) fetches
// it by id from GET /my-submissions/:id.
const PORTAL_SUBMISSION_LIST_FIELDS = [
  "idNo submissionId previousIdNos slfName slfGenerator",
  "dateOfDisposal lguCompanyName companyType address",
  "companyRegion companyProvince companyMunicipality companyBarangay",
  "status revertRequested revertReason revertRequestedAt revertedAt revertedBy",
  // Drives the history's Remarks column ("Resubmission" + the operator's note).
  RESUBMISSION_FIELDS,
  "submittedBy createdAt updatedAt isDummy hiddenFromPortal",
  "truckCount totalVolumeM3 totalVolumeTons residualVolumeM3 residualVolumeTons",
  "hazardousVolumeM3 hazardousVolumeTons",
  "trucks.cellIndex trucks.cellName trucks.cellType trucks.wasteType trucks.actualVolume trucks.truckCapacity",
  "trucks.vehicles.cellIndex trucks.vehicles.cellName trucks.vehicles.cellType trucks.vehicles.actualVolume trucks.vehicles.capacity",
].join(" ");

// Only the facility identity the history rows display. `cellNames` is included so
// a cell's CURRENT name can be resolved from its cellIndex rather than the stale
// name copied onto the truck at submit time.
// cellStatuses is included so a cellIndex pointing at a DELETED ("Not Existed")
// cell can be detected and treated as unassigned (see isValidCellRef).
const PORTAL_SLF_REF_FIELDS = "_id lgu slfName province cellNames cellStatuses";

// `cellCorrections[]` is the ADMIN audit trail of a waste-placement correction:
// who at EMB moved it, and the internal reason they recorded. The portal user
// sees the corrected placement itself — `trucks[].cellIndex/cellName` is already
// the current cell — and is notified when one happens, but the reviewer metadata
// is not theirs to read. Applied to every route that returns whole submission
// documents; the list projection above is a whitelist and never included it.
const PORTAL_HIDDEN_ADMIN_FIELDS = "-cellCorrections";

/**
 * facilityKey → Map(normalised plate → { capacity, capacityUnit }) from the SLF
 * baseline's accredited-hauler fleet.
 *
 * The operator declares each accredited vehicle's plate and capacity once, on
 * the baseline. Re-typing the same figure for every historical placement that
 * happens to be missing one is pure duplicate encoding, so the organizer offers
 * the declared value back.
 *
 * ONE query for the whole batch — the fleet is read per FACILITY, not per
 * submission, so a 60-submission organizer session still costs a single lookup.
 * A submission with no linked facility falls back to its SLF name, which is how
 * the rest of this route keys a facility too.
 *
 * ── WHY THIS IS BOUNDED AND CACHED ──────────────────────────────────────────
 * `accreditedHaulers` is deliberately DUPLICATED onto every one of an SLF's
 * baseline-carrying records (see mergeAccreditedHaulerCopies in routes/dataSLF.js)
 * and carries each hauler's vehicles AND its client lists, making it by far the
 * largest thing on the document — measured on production, one facility's 22
 * records hold 5,099 KB of it. This read had no limit, so opening Organize Cell
 * Placement pulled every copy and walked all of them in JS, to build a map in
 * which the newest record already supplies every plate (`add` never overwrites).
 * The same unbounded read of the same array is what made Data Entry time out for
 * that facility before it was projected down.
 *
 * Two bounds, neither of which changes the answer in practice:
 *   • FLEET_SOURCE_LIMIT — the copies are kept in sync, so the newest few records
 *     hold the whole fleet. The limit is generous enough to absorb a partially
 *     migrated facility while capping the worst case.
 *   • serverCache (Redis-backed when configured) — the fleet changes only on a
 *     baseline/submission write, and every one of those already invalidates
 *     PORTAL_FLEET_CAPACITY_PREFIX, so the cache is exact rather than merely
 *     time-bounded.
 */
const FLEET_SOURCE_LIMIT = 8;
const FLEET_CACHE_TTL_MS = 10 * 60 * 1000;

async function buildBaselineCapacityIndex(submissions = []) {
  const DataSLF = require("../models/DataSLF");
  const byKey = new Map();
  const facilityIds = new Set();
  const slfNames = new Set();
  submissions.forEach((sub) => {
    const id = sub?.slfGenerator?._id || sub?.slfGenerator;
    if (id) facilityIds.add(String(id));
    else if (sub?.slfName) slfNames.add(String(sub.slfName));
  });
  if (!facilityIds.size && !slfNames.size) return byKey;

  const or = [];
  if (facilityIds.size) or.push({ slfGenerator: { $in: [...facilityIds] } });
  if (slfNames.size) or.push({ slfName: { $in: [...slfNames] } });

  // Keyed by the exact facility set this batch spans, so two different SLFs never
  // share an entry. Sorted so the same set always produces the same key.
  const cacheKey =
    `${keys.PORTAL_FLEET_CAPACITY_PREFIX}:` +
    `${[...facilityIds].sort().join(",")}|${[...slfNames].sort().join(",")}`;

  const fleets = await serverCache.wrap(cacheKey, FLEET_CACHE_TTL_MS, async () =>
    DataSLF.find({
      deletedAt: null,
      "accreditedHaulers.0": { $exists: true },
      $and: [{ $or: or }],
    })
      .setOptions({ includeHiddenYears: true })
      .select("slfGenerator slfName accreditedHaulers.vehicles.plateNumber accreditedHaulers.vehicles.capacity accreditedHaulers.vehicles.capacityUnit accreditedHaulers.plateNumber accreditedHaulers.capacity accreditedHaulers.capacityUnit")
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(FLEET_SOURCE_LIMIT)
      .lean(),
  );

  const normalise = (plate) => String(plate || "").replace(/[\s-]+/g, "").toUpperCase();
  const add = (fleet, plate, capacity, unit) => {
    const key = normalise(plate);
    if (!key || !(Number(capacity) > 0)) return;
    // Newest record wins; the sort above put it first, so never overwrite.
    if (!fleet.has(key)) fleet.set(key, { capacity: Number(capacity), capacityUnit: unit || "" });
  };

  fleets.forEach((doc) => {
    [String(doc.slfGenerator || ""), String(doc.slfName || "")].filter(Boolean).forEach((key) => {
      if (!byKey.has(key)) byKey.set(key, new Map());
      const fleet = byKey.get(key);
      (doc.accreditedHaulers || []).forEach((hauler) => {
        (hauler.vehicles || []).forEach((v) => add(fleet, v?.plateNumber, v?.capacity, v?.capacityUnit));
        // Legacy single-vehicle haulers kept their plate/capacity on the hauler.
        add(fleet, hauler?.plateNumber, hauler?.capacity, hauler?.capacityUnit);
      });
    });
  });
  return byKey;
}

// Cell naming comes from the SHARED resolver so the Portal and the admin side can
// never disagree about what a cell is called. See utils/cellNaming.js.
const resolvePortalCellName = resolveCellName;

// A waste record counts as ASSIGNED only when it carries a VALID cell IDENTIFIER
// (cellIndex) — the schema's required key — that references an existing, non-deleted
// cell. A stored cellName WITHOUT a valid cellIndex is a display-name-only record
// and is treated as UNASSIGNED, so it surfaces in Organize Cells for the user to
// pick a real open cell (this is the Eco Protect-class bug: approved submissions
// whose waste had only a name copy were wrongly counted as placed).
//   • missing / null / "" / non-integer / negative  → invalid
//   • index >= the facility's cell count            → deleted/unavailable
//   • the referenced cell's status is "Not Existed" → deleted
// When the facility's cell arrays are unavailable (not populated), only the
// shape checks apply, so a populated cellIndex is not falsely rejected.
function isValidCellRef(cellIndex, facilityCellNames, facilityCellStatuses) {
  if (cellIndex === null || cellIndex === undefined || cellIndex === "") return false;
  const idx = Number(cellIndex);
  if (!Number.isInteger(idx) || idx < 0) return false;
  const count = Math.max(
    Array.isArray(facilityCellNames) ? facilityCellNames.length : 0,
    Array.isArray(facilityCellStatuses) ? facilityCellStatuses.length : 0,
  );
  if (count > 0 && idx >= count) return false; // points past the last cell → deleted
  const status = facilityCellStatuses?.[idx];
  if (status && /not\s*exist/i.test(String(status))) return false; // deleted cell
  return true;
}

// Summarize which cells a submission's waste was placed into, and how many
// placements are still UNASSIGNED. Computed here so the browser never has to walk
// every truck/vehicle of every submission just to render a column — and so the
// name always reflects an admin rename rather than the copy frozen at submit time.
function summarizeCellAssignment(entry) {
  const facilityCellNames = entry?.slfGenerator?.cellNames;
  const facilityCellStatuses = entry?.slfGenerator?.cellStatuses;
  const byName = new Map();
  let unplaced = 0;
  // Total unplaced waste volume (kept in the entry's stored unit) so the Portal
  // can name the exact volume still needing a cell in its blocking warning.
  let unplacedVolume = 0;
  // Approved historical submissions may pre-date the rule that Truck Capacity is
  // completed via Organize Cells. Count each entry (with waste) still missing a
  // positive capacity so the Portal can require it before new submissions (#6).
  let missingCapacity = 0;

  const record = (cellIndex, cellName, cellType, volume) => {
    // Assigned ONLY when a valid cell IDENTIFIER exists — a name-only record is
    // unassigned (schema requires the id). Only waste that actually EXISTS can be
    // "unplaced" — a zero-volume truck has nothing to assign.
    if (!isValidCellRef(cellIndex, facilityCellNames, facilityCellStatuses)) {
      if (Number(volume || 0) > 0) {
        unplaced += 1;
        unplacedVolume += Number(volume || 0);
      }
      return;
    }
    const name =
      resolvePortalCellName(facilityCellNames, cellIndex, cellName) ||
      `Cell ${Number(cellIndex) + 1}`;
    const existing = byName.get(name);
    if (existing) {
      existing.count += 1;
      return;
    }
    byName.set(name, {
      cellName: name,
      cellIndex: Number(cellIndex),
      cellType: cellType || "",
      count: 1,
    });
  };

  const isPositive = (v) => Number.isFinite(Number(v)) && Number(v) > 0;

  for (const truck of Array.isArray(entry?.trucks) ? entry.trucks : []) {
    const vehicles = (Array.isArray(truck?.vehicles) ? truck.vehicles : []).filter(
      (v) => Number(v?.actualVolume || 0) > 0,
    );
    if (vehicles.length) {
      // Placement lives on each vehicle when the truck carries them.
      for (const v of vehicles) {
        record(v?.cellIndex, v?.cellName, v?.cellType, v?.actualVolume);
        // Effective capacity is the vehicle's own, falling back to the truck's.
        if (!isPositive(v?.capacity) && !isPositive(truck?.truckCapacity)) missingCapacity += 1;
      }
    } else {
      record(truck?.cellIndex, truck?.cellName, truck?.cellType, truck?.actualVolume);
      if (Number(truck?.actualVolume || 0) > 0 && !isPositive(truck?.truckCapacity)) {
        missingCapacity += 1;
      }
    }
  }

  return {
    cellsAssigned: [...byName.values()],
    unplacedCount: unplaced,
    unplacedVolume: Number(unplacedVolume.toFixed(2)),
    missingCapacityCount: missingCapacity,
  };
}

// Used by the CREDENTIAL flows, which act on the caller's own account only.
// A developer-context token is refused here outright: changing a portal user's
// username/password is never a debugging operation, and a developer holding a
// context token is not that user. (Without this it would fall through to a
// confusing 404, since decoded.id would be the developer's id.)
async function getPortalUserFromToken(req, res) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    res.status(401).json({ message: "No token provided" });
    return null;
  }
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.role !== "portal_user") {
    writeLog("warn", "portal.credentials.denied", {
      message: "Non-portal token attempted a portal credential operation",
      user: decoded.email || decoded.id || "",
      ip: req.ip,
      meta: { role: decoded.role || "none", path: req.originalUrl },
    });
    res.status(403).json({
      message: "Credential changes can only be made by the portal account holder.",
    });
    return null;
  }
  const user = await UserPortal.findById(decoded.id);
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return null;
  }
  return user;
}

async function getCredentialUpdateUser(req, res) {
  const token = req.headers.authorization?.split(" ")[1];
  if (token) return getPortalUserFromToken(req, res);

  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) {
    res.status(400).json({ message: "Registered email is required" });
    return null;
  }
  const user = await UserPortal.findOne({ email });
  if (!user) {
    res.status(404).json({ message: "Portal user account not found" });
    return null;
  }
  return user;
}

function ensureCredentialSelfServiceEnabled(user, res) {
  if (!user?.allowCredentialSelfService) {
    res.status(403).json({ message: "Portal credential updates are currently disabled." });
    return false;
  }
  return true;
}

async function getPortalMaintenanceState() {
  const settings = await AppSettings.findOne().select(
    "portalMaintenanceMode portalMaintenanceReason portalMaintenanceMessage"
  );

  if (!settings?.portalMaintenanceMode) {
    return { active: false, message: "" };
  }

  return {
    active: true,
    message:
      settings.portalMaintenanceMessage ||
      settings.portalMaintenanceReason ||
      "The portal is currently under maintenance. Please try again later.",
  };
}

async function enforcePortalMaintenance(res) {
  const maintenance = await getPortalMaintenanceState();
  if (!maintenance.active) return false;

  res.status(503).json({
    message: maintenance.message,
    portalMaintenanceMode: true,
  });
  return true;
}

async function saveVerificationAttachment(req, file, email, logContext) {
  const isImage = file.mimetype.startsWith("image/");
  if (file.size >= DIRECT_LOCAL_UPLOAD_BYTES) {
    const localResult = await saveVerificationFile(file);
    writeLog("info", `${logContext}.local-large-file`, {
      message: `Large verification file stored locally for ${email}`,
      user: email,
      ip: req.ip,
      meta: { fileName: localResult.fileName, size: file.size },
    });
    return {
      url: localResult.url,
      driveId: "",
      fileType: isImage ? "image" : "document",
    };
  }

  try {
    const driveResult = await uploadFileToDrive(
      file.buffer,
      file.mimetype,
      file.originalname,
      isImage
    );
    return {
      url: driveResult.viewUrl,
      driveId: driveResult.fileId,
      fileType: isImage ? "image" : "document",
    };
  } catch (driveErr) {
    writeLog("warn", `${logContext}.drive`, {
      message: `Drive upload failed for ${email}: ${driveErr.message}`,
      user: email,
      ip: req.ip,
    });

    const localResult = await saveVerificationFile(file);
    writeLog("info", `${logContext}.local-fallback`, {
      message: `Drive unavailable — verification file stored locally for ${email}`,
      user: email,
      ip: req.ip,
      meta: { fileName: localResult.fileName },
    });
    console.info(`[portal-auth] Verification file saved locally (Drive unavailable) — ${localResult.fileName}`);

    return {
      url: localResult.url,
      driveId: "",
      fileType: isImage ? "image" : "document",
    };
  }
}

function recordVerificationSubmission(user, { action = "submitted", note = "", performedBy = "" } = {}) {
  if (!user.verificationFileUrl) return;
  const history = Array.isArray(user.verificationSubmissionHistory)
    ? user.verificationSubmissionHistory
    : [];
  const alreadyRecorded = history.some(
    (item) => item.fileUrl === user.verificationFileUrl && item.action === action
  );
  if (alreadyRecorded) return;
  history.push({
    fileUrl: user.verificationFileUrl,
    fileDriveId: user.verificationFileDriveId || "",
    fileType: user.verificationFileType || "",
    officeEmail: user.officeEmail || "",
    pcoEmail: user.pcoEmail || "",
    action,
    note,
    performedBy,
    submittedAt: new Date(),
  });
  user.verificationSubmissionHistory = history;
}

router.get("/verification-files/:fileName", (req, res) => {
  try {
    const filePath = resolveVerificationFile(req.params.fileName);
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

// Multer: memory storage — files stay in RAM as Buffer for Drive upload
const MAX_UPLOAD_MB = 200;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const DIRECT_LOCAL_UPLOAD_MB = 25;
const DIRECT_LOCAL_UPLOAD_BYTES = DIRECT_LOCAL_UPLOAD_MB * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter(req, file, cb) {
    const allowed = [
      "image/jpeg", "image/png", "image/gif", "image/webp",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error("Unsupported file type. Please upload an image or PDF/DOC/DOCX."));
  },
});

// Portal Sign Up — register as SLF portal user (pending approval)
// Accepts multipart/form-data with an optional verificationFile field.
router.get("/check-existing", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    const username = String(req.query.username || "").trim().toLowerCase();
    if (!email && !username) return res.status(400).json({ message: "Email or username is required." });
    const existing = await UserPortal.findOne({
      $or: [
        email ? { email } : null,
        username ? { username } : null,
      ].filter(Boolean),
    }).select("email username status");
    res.json({
      exists: !!existing,
      emailMatch: !!existing && !!email && existing.email === email,
      usernameMatch: !!existing && !!username && existing.username === username,
      status: existing?.status || null,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.post("/signup", uploadSingle(upload, "verificationFile", { maxSizeMb: MAX_UPLOAD_MB }), async (req, res) => {
  try {
    if (await enforcePortalMaintenance(res)) return;

    const {
      firstName,
      lastName,
      email,
      username,
      password,
      contactNumber,
      companyName,
      officeEmail,
      pcoEmail,
    } = req.body;

    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedUsername = String(username || normalizedEmail.split("@")[0] || "")
      .trim()
      .toLowerCase();
    const existing = await UserPortal.findOne({
      $or: [
        { email: normalizedEmail },
        ...(normalizedUsername ? [{ username: normalizedUsername }] : []),
      ],
    });
    if (existing) {
      return res.status(400).json({ message: "Email or username already registered" });
    }

    // Upload verification file to Google Drive if provided
    let verificationFileUrl = "";
    let verificationFileDriveId = "";
    let verificationFileType = "";

    if (req.file) {
      try {
        const storedFile = await saveVerificationAttachment(req, req.file, email, "portal.signup");
        verificationFileUrl = storedFile.url;
        verificationFileDriveId = storedFile.driveId;
        verificationFileType = storedFile.fileType;
      } catch (fileErr) {
        // Log but do not block registration
        writeLog("warn", "portal.signup.file", {
          message: `Verification file storage failed for ${email}: ${fileErr.message}`,
          user: email,
          ip: req.ip,
        });
        // Non-blocking — registration continues even if attachment storage fails
      }
    }

    const user = new UserPortal({
      firstName,
      lastName,
      email: normalizedEmail,
      username: normalizedUsername,
      password,
      contactNumber: contactNumber || "",
      companyName: companyName || "",
      officeEmail: officeEmail || "",
      pcoEmail: pcoEmail || "",
      verificationFileUrl,
      verificationFileDriveId,
      verificationFileType,
      status: "pending",
      isVerified: true, // auto-verified; admin approval is the gate
    });
    recordVerificationSubmission(user, {
      action: "submitted",
      note: "Initial portal registration attachment",
      performedBy: normalizedEmail,
    });
    await user.save();

    // Send signup confirmation email (non-blocking)
    sendPortalSignupEmail(user.email, user.firstName).catch(() => {});

    // Notify admins of new portal user
    try {
      await Notification.create({
        recipient: "admin",
        type: "new_portal_user",
        title: "New Portal Registration",
        message: `${firstName} ${lastName} (${email}) registered and is pending approval`,
        meta: { email, companyName: companyName || "" },
      });
      notifyAdmin(req, { type: "new_portal_user", title: "New Portal Registration", message: `${firstName} ${lastName} (${email}) registered and is pending approval` });
    } catch { /* silent */ }

    writeLog("info", "portal.signup", {
      message: `Portal signup: ${email}`,
      user: email,
      ip: req.ip,
    });

    res.status(201).json({
      message: "Registration submitted successfully. Please wait for admin approval.",
    });
  } catch (error) {
    if (error.message?.includes("Unsupported file type")) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Portal Login — only approved accounts
router.post("/login", async (req, res) => {
  try {
    if (await enforcePortalMaintenance(res)) return;

    const { email, password } = req.body;
    const loginId = String(email || "").trim().toLowerCase();
    const loginMeta = (status, reason = "") => ({
      status,
      reason,
      role: "portal_user",
      userAgent: req.get("user-agent") || "",
    });

    const user = await UserPortal.findOne({
      $or: [{ email: loginId }, { username: loginId }],
    });
    if (!user) {
      writeLog("warn", "portal.login.failed", {
        message: `Portal login failed: ${loginId} (account not found)`,
        user: loginId,
        ip: req.ip,
        meta: loginMeta("failed", "account_not_found"),
      });
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (user.status === "pending") {
      writeLog("warn", "portal.login.denied", {
        message: `Portal login denied: ${loginId} (pending approval)`,
        user: loginId,
        ip: req.ip,
        meta: loginMeta("denied", "pending_approval"),
      });
      return res.status(403).json({
        message: "Your account is still pending approval. Please wait for admin approval.",
      });
    }
    if (user.status === "rejected") {
      writeLog("warn", "portal.login.denied", {
        message: `Portal login denied: ${loginId} (registration rejected)`,
        user: loginId,
        ip: req.ip,
        meta: loginMeta("denied", "registration_rejected"),
      });
      return res.status(403).json({
        message: "Your account registration has been rejected. Please contact the administrator.",
      });
    }
    if (user.blocked) {
      writeLog("warn", "portal.login.denied", {
        message: `Portal login denied: ${loginId} (blocked)`,
        user: loginId,
        ip: req.ip,
        meta: loginMeta("denied", "blocked"),
      });
      return res.status(403).json({
        message: user.blockedReason || "Your portal account is blocked. Please contact the administrator.",
      });
    }
    if (user.maintenanceMode) {
      writeLog("warn", "portal.login.denied", {
        message: `Portal login denied: ${loginId} (account maintenance)`,
        user: loginId,
        ip: req.ip,
        meta: loginMeta("denied", "account_maintenance"),
      });
      return res.status(403).json({
        message: user.maintenanceReason || "Your portal account is temporarily under maintenance. Please contact the administrator.",
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      writeLog("warn", "portal.login.failed", {
        message: `Portal login failed: ${loginId} (invalid password)`,
        user: loginId,
        ip: req.ip,
        meta: loginMeta("failed", "invalid_password"),
      });
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // `email` rides in the token so the ownership guards ("your own tickets",
    // "your own drafts") have an identity to compare against without a DB read.
    // Without it `req.user.email` was undefined on every portal request, and the
    // support-ticket self-check compared "" against the requested address and
    // refused — every portal user, not just one account.
    const token = jwt.sign(
      {
        id: user._id,
        role: "portal_user",
        email: String(user.email || "").trim().toLowerCase(),
        isDemo: Boolean(user.isDemo),
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful",
      token,
      // Flag so the front-end can keep held users out of the portal until admin review clears the hold.
      needsVerification: user.verificationRequired,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        email: user.email,
        contactNumber: user.contactNumber,
        companyName: user.companyName,
        officeEmail: user.officeEmail,
        pcoEmail: user.pcoEmail,
        assignedSlf: user.assignedSlf,
        assignedSlfName: user.assignedSlfName,
        verificationRequired: user.verificationRequired,
        verificationSubmitted: user.verificationSubmitted,
        allowCredentialSelfService: user.allowCredentialSelfService,
        status: user.status,
        isVerified: user.isVerified,
        // The per-user rule set the portal gates its own controls on (Save
        // Baseline, Upload Excel, Submit, VERA). It only arrived on the /me
        // refresh that follows, so the first render after signing in showed
        // every control regardless of what the account is actually allowed —
        // and a control that disappears a second later reads as a glitch.
        portalAccess: user.portalAccess,
        role: "portal_user",
      },
    });

    writeLog("info", "portal.login", {
      message: `Portal login: ${loginId}`,
      user: loginId,
      ip: req.ip,
      meta: loginMeta("success"),
    });
    UserPortal.updateOne({ _id: user._id }, { lastActiveAt: new Date() }).catch(() => {});
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get current portal user
router.get("/me", async (req, res) => {
  try {
    if (await enforcePortalMaintenance(res)) return;

    // Resolves to the caller's own account, or — for a developer holding an
    // explicit portal context — the TARGET user's account. The role is re-checked
    // inside resolvePortalContext, so this cannot be reached with a portal token
    // pointing at someone else.
    const ctx = await resolvePortalContext(req, {
      targetPortalUserId: req.query.targetPortalUserId,
      targetEmail: req.query.email,
    });
    // The shared context projection is intentionally narrow; /me needs the fuller
    // profile the Portal actually renders. Re-read it here with credentials
    // explicitly excluded rather than widening the shared projection (which is
    // also used by developer-facing routes).
    const user = await UserPortal.findById(ctx.portalUser._id).select(
      "-password -resetToken -resetTokenExpiry",
    );
    if (!user) return res.status(404).json({ message: "User not found" });

    // A developer inspecting a blocked / under-maintenance account must still be
    // able to SEE it — that is exactly the state they are debugging. These gates
    // only stop the portal user themselves from getting in.
    if (!ctx.impersonating) {
      if (user.blocked) {
        return res.status(403).json({ message: user.blockedReason || "Portal account blocked" });
      }
      if (user.maintenanceMode) {
        return res.status(403).json({ message: user.maintenanceReason || "Portal account under maintenance" });
      }

      // Touch presence (throttled to once/minute) so admins can see online status.
      // Skipped in developer context — a developer looking at an account must not
      // make that account appear "online".
      const now = Date.now();
      if (!user.lastActiveAt || now - new Date(user.lastActiveAt).getTime() > 60000) {
        UserPortal.updateOne({ _id: user._id }, { lastActiveAt: new Date() }).catch(() => {});
      }
    }

    // Tell the Portal it is in a read-only developer context so it can badge the
    // session and disable write actions. (The backend enforces it regardless.)
    const payload = user.toObject ? user.toObject() : { ...user };
    if (ctx.impersonating) {
      payload.developerContext = true;
      payload.readOnly = false;
      payload.developerEmail = ctx.actor;
    }
    res.json(payload);
  } catch (error) {
    return sendPortalContextError(res, error);
  }
});

// ── Per-user portal UI dismissals ────────────────────────────────────────────
// "Don't show again" for the What's New guided tour, and "Dismiss" on the portal
// announcement banner.
//
// Both used to live only in the browser, and both came straight back:
//   • the tour's dismissal was a localStorage key, and portal logout calls
//     secureStorage.clearAll() → localStorage.clear(), so it was wiped on the way
//     out and the tour greeted the user again on the very next login;
//   • the banner's Dismiss was React state only, so it returned on every reload.
// The same defect was fixed once already for the VERA introduction by moving the
// flag server-side (UserPortal.veraOnboardingDismissedAt). This is that fix,
// applied to the other two, and it carries the choices across browsers/devices.
//
// ONE endpoint for both: they are the same class of data, read at the same moment
// on portal load, and two round trips for two flags is waste. The PATCH applies
// only the keys actually present in the body, so dismissing one can never clear
// the other.
const UI_PREFERENCE_FIELDS =
  "portalTourDismissedAt portalAnnouncementDismissedVersion portalAnnouncementDismissedAt " +
  "portalFeatureTourVersionSeen portalFeatureTourSeenAt portalFeatureTourOptOutAt";

const uiPreferencePayload = (doc) => ({
  tourDismissed: !!doc?.portalTourDismissedAt,
  tourDismissedAt: doc?.portalTourDismissedAt || null,
  // The version the user dismissed. The client compares it against the CURRENT
  // announcement's version, so a newly published announcement still shows.
  announcementDismissedVersion: doc?.portalAnnouncementDismissedVersion || null,
  announcementDismissedAt: doc?.portalAnnouncementDismissedAt || null,
  // Same rule for the feature tour, against the CURRENT release version — so a
  // user who dismissed the last one still sees the next.
  featureTourVersionSeen: doc?.portalFeatureTourVersionSeen || null,
  featureTourSeenAt: doc?.portalFeatureTourSeenAt || null,
  // …and the permanent opt-out, which outranks the version above: "Don't show
  // this again" means never, not "not until the next release".
  featureTourOptOut: !!doc?.portalFeatureTourOptOutAt,
});

router.get("/ui-preferences", async (req, res) => {
  try {
    const ctx = await resolvePortalContext(req);
    // Read the flags directly rather than widening PORTAL_USER_SAFE_FIELDS — that
    // projection is the security boundary for every portal context read, and a UI
    // preference is not a reason to loosen it.
    const doc = await require("../models/UserPortal")
      .findById(ctx.portalUser._id)
      .select(UI_PREFERENCE_FIELDS)
      .lean();
    res.json(uiPreferencePayload(doc));
  } catch {
    // Never block the portal on a preference read. "Nothing dismissed" is the safe
    // default — an announcement the user has already read is a far smaller problem
    // than one they never see, and both stay dismissible either way.
    res.json({ ...uiPreferencePayload(null), unavailable: true });
  }
});

router.patch("/ui-preferences", async (req, res) => {
  try {
    // The ONE thing Developer Portal Mode still may not write.
    //
    // Developer Portal Mode now has full control of the portal side — it submits,
    // saves baselines, edits and deletes on the operator's behalf, all audited.
    // This is deliberately excluded because it is not an ACTION a developer takes,
    // it is a side effect of LOOKING: opening the portal to inspect an account
    // would mark that operator's one-time tour and their unread "What's New" as
    // consumed, and they can never be shown again. Destroying a one-time event for
    // someone by viewing their screen is not control, it is damage.
    //
    // The client keeps a local mirror, so both still stay closed for the
    // developer's own session — nothing about the inspection experience changes.
    const ctx = await resolvePortalContext(req);
    if (ctx.impersonating) {
      writeLog("warn", "portal.context.preference-write-blocked", {
        message: `Developer blocked from consuming ${ctx.email}'s tour/announcement`,
        user: ctx.actor,
        ip: req.ip,
        meta: { targetEmail: ctx.email, path: req.originalUrl },
      });
      return res.status(403).json({
        message:
          "Developer Portal Mode does not consume the portal user's tour or announcements — that would use up a one-time notice they have not seen yet.",
      });
    }

    const update = {};
    if (Object.hasOwn(req.body || {}, "tourDismissed")) {
      const dismissed = req.body.tourDismissed === true || req.body.tourDismissed === "true";
      update.portalTourDismissedAt = dismissed ? new Date() : null;
    }
    if (Object.hasOwn(req.body || {}, "announcementDismissedVersion")) {
      const version = String(req.body.announcementDismissedVersion ?? "").trim();
      update.portalAnnouncementDismissedVersion = version || null;
      update.portalAnnouncementDismissedAt = version ? new Date() : null;
    }
    if (Object.hasOwn(req.body || {}, "featureTourVersionSeen")) {
      // Bounded: this is a client-supplied release marker written straight to
      // the record, so it is trimmed and capped rather than trusted for length.
      const version = String(req.body.featureTourVersionSeen ?? "").trim().slice(0, 80);
      update.portalFeatureTourVersionSeen = version || null;
      update.portalFeatureTourSeenAt = version ? new Date() : null;
    }
    if (Object.hasOwn(req.body || {}, "featureTourOptOut")) {
      // Explicitly reversible: `false` clears it, so What's New can put a user
      // back on the tour if they change their mind.
      const optOut =
        req.body.featureTourOptOut === true || req.body.featureTourOptOut === "true";
      update.portalFeatureTourOptOutAt = optOut ? new Date() : null;
    }
    if (!Object.keys(update).length) {
      return res.status(400).json({ message: "No preference was provided." });
    }

    const updated = await require("../models/UserPortal")
      .findByIdAndUpdate(ctx.portalUser._id, update, {
        returnDocument: "after",
        select: UI_PREFERENCE_FIELDS,
      })
      .lean();
    if (!updated) return res.status(404).json({ message: "Portal user not found." });
    res.json(uiPreferencePayload(updated));
  } catch (error) {
    return sendPortalContextError(res, error);
  }
});

// Update the logged-in portal user's location-sharing preference and/or
// record their current browser location for activity tracing.
router.patch("/location", async (req, res) => {
  try {
    // WRITE: a developer inspecting this account must not stamp their own browser
    // location onto the portal user's record.
    const ctx = await resolvePortalContext(req);
    assertPortalWriteAllowed(ctx, req);
    const user = await UserPortal.findById(ctx.portalUser._id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const { enabled, lat, lng, accuracy, label } = req.body || {};
    if (typeof enabled === "boolean") {
      user.locationSharingEnabled = enabled;
    }

    let recordedGeo = null;
    if (
      user.locationSharingEnabled &&
      typeof lat === "number" &&
      typeof lng === "number"
    ) {
      const locationLabel =
        label ||
        (Number.isFinite(lat) && Number.isFinite(lng)
          ? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
          : "");
      user.lastKnownLocation = {
        lat,
        lng,
        accuracy: typeof accuracy === "number" ? accuracy : undefined,
        label: locationLabel,
        updatedAt: new Date(),
      };
      recordedGeo = {
        lat,
        lng,
        accuracy: typeof accuracy === "number" ? accuracy : undefined,
        label: locationLabel,
        source: "browser",
      };
    }
    await user.save();

    writeLog("info", "portal.location-update", {
      message: `${user.email} ${user.locationSharingEnabled ? "shared location" : "disabled location sharing"}`,
      user: user.email,
      ip: req.ip,
      geo: recordedGeo || undefined,
    });

    res.json({
      message: "Location preference updated",
      locationSharingEnabled: user.locationSharingEnabled,
      lastKnownLocation: user.lastKnownLocation,
    });
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
  }
});
router.get("/my-submissions", async (req, res) => {
  try {
    // Identity comes from the token. A portal user always gets their OWN history —
    // a `targetPortalUserId`/`email` naming anyone else is rejected. A developer
    // may explicitly select another portal user's context (Developer Portal Mode),
    // which resolvePortalContext audits.
    const ctx = await resolvePortalContext(req, {
      targetPortalUserId: req.query.targetPortalUserId,
      targetEmail: req.query.email,
    });
    const user = ctx.portalUser;

    const DataSLF = require("../models/DataSLF");
    const submissions = await DataSLF.find(
      {
        submittedBy: user.email,
        deletedAt: null,
        // Only real submissions. A record with no transport entries is the
        // baseline-only container written by PATCH /portal-save-baseline — never
        // something the user submitted — and listing it put a phantom
        // "0 / No Waste Data / Pending" row in Submission History after the first
        // baseline save. See SUBMISSION_HAS_TRUCKS in routes/dataSLF.js.
        "trucks.0": { $exists: true },
        // A REVERTED submission is always listed, even if the user had previously
        // removed it from their history.
        //
        // Hiding is the user's own housekeeping, but a revert is the admin handing
        // the record BACK with "correct this and resubmit" — and the unresolved
        // -revert rule then blocks their next submission until they do. While
        // `hiddenFromPortal` could out-rank that, the row they were told to fix was
        // unreachable: SLF-LGU-NE-0111 was reverted on 2026-08-12 and stayed
        // invisible to its operator. The revert routes clear the flag, but that only
        // holds until the next hide, so the guarantee belongs HERE, in the read —
        // where nothing later can undo it. PATCH /my-submissions/:id/hide also
        // refuses a reverted row, so the two agree.
        $or: [{ hiddenFromPortal: { $ne: true } }, { status: "reverted" }],
      },
      PORTAL_SUBMISSION_LIST_FIELDS,
    )
      .populate("slfGenerator", PORTAL_SLF_REF_FIELDS)
      .sort({ createdAt: -1 })
      .lean();

    // Derive the cell-placement summary, then DROP trucks — the list renders none
    // of it, and it was the bulk of the payload.
    const rows = submissions.map((entry) => {
      const { cellsAssigned, unplacedCount, missingCapacityCount } = summarizeCellAssignment(entry);
      const { trucks, ...rest } = entry;
      return {
        ...rest,
        cellsAssigned,
        unplacedCount,
        missingCapacityCount,
        resubmission: resubmissionSummary(entry),
      };
    });

    // REVERTED FIRST — these are the only rows that need the operator to do
    // something, and they are what blocks their next submission. Newest-first alone
    // buried a revert under every submission made since. Ordering is applied here
    // rather than in the query because it is a two-level sort (needs-action, then
    // recency) and the list is one operator's own history, not a paged set.
    //
    // Within each group the original newest-first order is preserved.
    const needsAction = (row) => (String(row.status || "") === "reverted" ? 0 : 1);
    rows.sort((a, b) => {
      const byAction = needsAction(a) - needsAction(b);
      if (byAction !== 0) return byAction;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    res.json(rows);
  } catch (error) {
    return sendPortalContextError(res, error);
  }
});

// FULL records for MANY submissions, in ONE request.
//
// The cell organizer needs the whole record (trucks + per-vehicle placements) for
// every submission with unplaced waste. Fetching them one-by-one meant ~60 requests
// fired at once, which tripped the /api/portal-auth rate limiter (50 per 15 min →
// HTTP 429) and spiked browser memory with ~60 concurrent responses in flight.
//
// Same authorization as the single-record route: rows that don't belong to the
// resolved context are simply not returned — an id from another user's account
// yields nothing rather than leaking a record.
//
// Declared BEFORE "/my-submissions/:id" so "batch" isn't captured as an id.
const MAX_BATCH_IDS = 300;

router.post("/my-submissions/batch", async (req, res) => {
  try {
    const ctx = await resolvePortalContext(req, {
      targetPortalUserId: req.body?.targetPortalUserId,
      targetEmail: req.body?.email,
    });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.json([]);
    if (ids.length > MAX_BATCH_IDS) {
      return res.status(400).json({ message: `Too many ids (max ${MAX_BATCH_IDS}).` });
    }
    const valid = ids.filter((id) => mongoose.Types.ObjectId.isValid(String(id)));
    if (!valid.length) return res.json([]);

    const DataSLF = require("../models/DataSLF");
    const unassignedOnly = req.body?.unassignedOnly === true;

    const query = DataSLF.find({
      _id: { $in: valid },
      // Ownership enforced in the QUERY, so another user's id can never come back.
      submittedBy: ctx.email,
      deletedAt: null,
    }).populate("slfGenerator", PORTAL_SLF_REF_FIELDS);

    // The cell organizer only ever touches placements that still need a cell, so it
    // asks for exactly those. A submission with 20 trucks of which 1 is unassigned
    // ships 1 placement, not 20 full trucks — that is what made opening the organizer
    // slow and memory-heavy. Everything else (Edit & Resubmit) still gets the whole
    // record.
    if (unassignedOnly) {
      query.select(
        "idNo submissionId slfName slfGenerator dateOfDisposal lguCompanyName status " +
          "trucks.disposalTicketNo trucks.hauler trucks.plateNumber trucks.wasteType trucks.actualVolume " +
          "trucks.actualVolumeUnit trucks.truckCapacity trucks.truckCapacityUnit " +
          "trucks.cellIndex trucks.cellName trucks.cellType " +
          "trucks.vehicles.plateNumber trucks.vehicles.wasteType trucks.vehicles.actualVolume " +
          "trucks.vehicles.actualVolumeUnit trucks.vehicles.capacity trucks.vehicles.capacityUnit " +
          "trucks.vehicles.cellIndex trucks.vehicles.cellName trucks.vehicles.cellType",
      );
    } else {
      // Whole records — strip the admin-only correction trail. (Mongoose rejects
      // mixing this exclusion with the inclusion projection above, hence the
      // else.)
      query.select(PORTAL_HIDDEN_ADMIN_FIELDS);
    }

    const submissions = await query.lean();

    if (!unassignedOnly) {
      // Resolve the denormalized cell-name copies to the facility's CURRENT
      // labels before responding — the Portal renders truck.cellName directly.
      return res.json(
        submissions.map((entry) => {
          const resolved = applyResolvedCellNames(entry);
          return { ...resolved, ...summarizeCellAssignment(resolved) };
        }),
      );
    }

    // Flatten to the INCOMPLETE placements only — those that still need a cell OR
    // are missing a positive Truck Capacity (#6). The canonical truckIndex /
    // vehicleIndex is preserved so a save still targets the exact slot. Each row
    // carries `needsCell` / `needsCapacity` so the organizer knows which inputs to
    // ask for. A placement that already has both a cell and a capacity is complete
    // and is not offered.
    const isPositive = (v) => Number.isFinite(Number(v)) && Number(v) > 0;

    // ── Truck capacity the operator ALREADY declared ──────────────────────────
    // The SLF's baseline records its accredited fleet: every vehicle's plate
    // number and that vehicle's capacity. When a historical placement is missing
    // a Truck Capacity, that figure is usually already on file — so it is offered
    // back as a suggestion keyed on the plate, and the organizer pre-fills it
    // instead of asking the operator to type a number they have already given us.
    //
    // It is a SUGGESTION, never a silent write: nothing is persisted until the
    // user saves the arrangement, and a plate with no baseline entry (or a
    // baseline capacity of zero) yields nothing rather than a guess.
    const capacityByPlate = await buildBaselineCapacityIndex(submissions);
    const plateKey = (plate) => String(plate || "").replace(/[\s-]+/g, "").toUpperCase();
    const suggestCapacity = (facilityKey, ...plates) => {
      const fleet = capacityByPlate.get(facilityKey);
      if (!fleet) return null;
      for (const plate of plates) {
        const key = plateKey(plate);
        if (key && fleet.has(key)) return fleet.get(key);
      }
      return null;
    };
    const rows = submissions.map((sub) => {
      // Same validity rule as summarizeCellAssignment: a placement needs a cell
      // unless it already has a VALID cell identifier (not just a name copy).
      const facilityCellNames = sub.slfGenerator?.cellNames;
      const facilityCellStatuses = sub.slfGenerator?.cellStatuses;
      const facilityKey = String(sub.slfGenerator?._id || sub.slfGenerator || sub.slfName || "");
      const placements = [];
      (sub.trucks || []).forEach((truck, truckIndex) => {
        const vehicles = (truck.vehicles || []).filter(
          (v) => Number(v?.actualVolume || 0) > 0,
        );
        if (vehicles.length) {
          (truck.vehicles || []).forEach((v, vehicleIndex) => {
            if (Number(v?.actualVolume || 0) <= 0) return; // nothing to place
            const effectiveCapacity = v.capacity ?? truck.truckCapacity ?? null;
            const needsCell = !isValidCellRef(v?.cellIndex, facilityCellNames, facilityCellStatuses);
            const needsCapacity = !isPositive(effectiveCapacity);
            if (!needsCell && !needsCapacity) return; // already complete
            const suggested = needsCapacity
              ? suggestCapacity(facilityKey, v?.plateNumber, truck?.plateNumber)
              : null;
            placements.push({
              suggestedCapacity: suggested?.capacity ?? null,
              suggestedCapacityUnit: suggested?.capacityUnit || "",
              suggestedCapacitySource: suggested ? "baseline" : "",
              truckIndex,
              vehicleIndex,
              // The disposal ticket the operator wrote on the trip. It is the
              // reference they recognise on paper, so the bulk-organize template
              // carries it; it is never generated when the trip has none.
              disposalTicketNo: truck.disposalTicketNo || "",
              hauler: truck.hauler || "",
              plateNumber: v.plateNumber || truck.plateNumber || "",
              wasteType: v.wasteType || truck.wasteType || "",
              actualVolume: v.actualVolume,
              actualVolumeUnit: v.actualVolumeUnit || truck.actualVolumeUnit || "",
              capacity: effectiveCapacity,
              capacityUnit: v.capacityUnit || truck.truckCapacityUnit || "",
              cellName: resolvePortalCellName(facilityCellNames, v.cellIndex, v.cellName),
              cellIndex: Number.isInteger(Number(v.cellIndex)) ? Number(v.cellIndex) : null,
              cellType: v.cellType || "",
              needsCell,
              needsCapacity,
            });
          });
          return;
        }
        // Truck-level placement (no per-vehicle split).
        if (Number(truck?.actualVolume || 0) <= 0) return;
        const needsCell = !isValidCellRef(truck?.cellIndex, facilityCellNames, facilityCellStatuses);
        const needsCapacity = !isPositive(truck?.truckCapacity);
        if (!needsCell && !needsCapacity) return; // already complete
        const suggested = needsCapacity ? suggestCapacity(facilityKey, truck?.plateNumber) : null;
        placements.push({
          suggestedCapacity: suggested?.capacity ?? null,
          suggestedCapacityUnit: suggested?.capacityUnit || "",
          suggestedCapacitySource: suggested ? "baseline" : "",
          truckIndex,
          vehicleIndex: null,
          disposalTicketNo: truck.disposalTicketNo || "",
          hauler: truck.hauler || "",
          plateNumber: truck.plateNumber || "",
          wasteType: truck.wasteType || "",
          actualVolume: truck.actualVolume,
          actualVolumeUnit: truck.actualVolumeUnit || "",
          capacity: truck.truckCapacity ?? null,
          capacityUnit: truck.truckCapacityUnit || "",
          cellName: resolvePortalCellName(facilityCellNames, truck.cellIndex, truck.cellName),
          cellIndex: Number.isInteger(Number(truck.cellIndex)) ? Number(truck.cellIndex) : null,
          cellType: truck.cellType || "",
          needsCell,
          needsCapacity,
        });
      });
      return {
        _id: sub._id,
        idNo: sub.idNo,
        submissionId: sub.submissionId,
        slfName: sub.slfName,
        dateOfDisposal: sub.dateOfDisposal,
        lguCompanyName: sub.lguCompanyName,
        status: sub.status,
        placements,
      };
    });

    // A submission whose waste is now fully placed has nothing to organize.
    res.json(rows.filter((r) => r.placements.length > 0));
  } catch (error) {
    return sendPortalContextError(res, error);
  }
});

// FULL single submission — trucks, haulers, baseline fields and all.
//
// The history LIST is deliberately lean, so everything that needs the whole record
// (Edit & Resubmit, the cell organizer) pulls it from here, by id, on demand. Same
// authorization as the list: a portal user can only read their own submission; a
// developer may read one inside an explicit portal context.
router.get("/my-submissions/:id", async (req, res) => {
  try {
    const ctx = await resolvePortalContext(req, {
      targetPortalUserId: req.query.targetPortalUserId,
      targetEmail: req.query.email,
    });
    const DataSLF = require("../models/DataSLF");
    const submission = await DataSLF.findById(req.params.id)
      .select(PORTAL_HIDDEN_ADMIN_FIELDS)
      .populate("slfGenerator", PORTAL_SLF_REF_FIELDS)
      .lean();
    if (!submission) return res.status(404).json({ message: "Submission not found" });

    // Ownership is checked against the RESOLVED context, so a portal user cannot
    // read another user's submission by guessing its id.
    if (
      String(submission.submittedBy || "").toLowerCase() !==
      String(ctx.email).toLowerCase()
    ) {
      return res.status(403).json({ message: "You can only view your own submissions." });
    }

    const { cellsAssigned, unplacedCount, missingCapacityCount } = summarizeCellAssignment(submission);
    res.json({ ...submission, cellsAssigned, unplacedCount, missingCapacityCount });
  } catch (error) {
    return sendPortalContextError(res, error);
  }
});

/**
 * The portal user's OWN disposal report.
 *
 * Identity is resolved from the token by resolvePortalContext, exactly as
 * /my-submissions does — a `targetPortalUserId`/`email` naming anyone else is
 * refused there and audited, so this endpoint cannot be pointed at another
 * operator. The query then filters on that resolved email, which means the
 * scoping is a property of the query rather than a check that could be forgotten.
 *
 * `trucks` IS selected here, unlike the list endpoint that drops it: the
 * per-hauler, per-client and per-cell breakdowns are the point of a report, and
 * they are aggregated SERVER-side (see utils/portalReport) so the browser is sent
 * a summary rather than every transport row.
 *
 * `from` / `to` are optional ISO dates. They narrow by DISPOSAL date, not by
 * submission date, because that is the period an operator reports on.
 */
router.get("/my-report", async (req, res) => {
  try {
    const ctx = await resolvePortalContext(req, {
      targetPortalUserId: req.query.targetPortalUserId,
      targetEmail: req.query.email,
    });
    const user = ctx.portalUser;

    const DataSLF = require("../models/DataSLF");
    const SlfFacility = require("../models/SlfFacility");

    const range = {};
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    const dateFilter = {};
    if (from && !Number.isNaN(from.getTime())) {
      dateFilter.$gte = from;
      range.from = from.toISOString();
    }
    if (to && !Number.isNaN(to.getTime())) {
      dateFilter.$lte = to;
      range.to = to.toISOString();
    }

    const query = {
      submittedBy: user.email,
      deletedAt: null,
      // Baseline-only containers carry no transport entries and are not
      // submissions — the same exclusion /my-submissions applies.
      "trucks.0": { $exists: true },
    };
    if (Object.keys(dateFilter).length) query.dateOfDisposal = dateFilter;

    const assignedIds = Array.isArray(user.assignedSlf)
      ? user.assignedSlf.filter(Boolean)
      : user.assignedSlf
        ? [user.assignedSlf]
        : [];

    const [submissions, facility] = await Promise.all([
      DataSLF.find(query)
        .select(
          "idNo submissionId status dateOfDisposal createdAt baselineUnit " +
            "totalVolumeM3 totalVolumeTons residualVolumeTons hazardousVolumeTons trucks",
        )
        .sort({ dateOfDisposal: -1 })
        .lean(),
      assignedIds.length
        ? SlfFacility.findById(assignedIds[0])
            .select(
              "lgu slfName province barangay category ownership statusOfSLF numberOfCell " +
                "cellNames cellStatuses cellCapacities cellFillValues cellTypes cellCapacityUnits " +
                "permitToOperate permitToOperateValidity dischargePermit dischargePermitValidity eccNo",
            )
            .lean()
            .catch(() => null)
        : null,
    ]);

    const report = buildPortalReport(submissions, { facility, range });
    res.json({
      ...report,
      preparedFor: { name: user.name || "", email: user.email, facility: report.facility?.name || "" },
    });
  } catch (error) {
    return sendPortalContextError(res, error);
  }
});

// Portal user hides one of their own submissions from their Submission History.
// The record stays intact and visible on the admin side — this only sets the
// hiddenFromPortal flag so it no longer appears in the portal user's own list.
router.patch("/my-submissions/:id/hide", async (req, res) => {
  try {
    // WRITE: a developer must not hide another user's submissions from their
    // history while merely inspecting the account.
    const ctx = await resolvePortalContext(req);
    assertPortalWriteAllowed(ctx, req);
    const user = ctx.portalUser;

    const DataSLF = require("../models/DataSLF");
    const submission = await DataSLF.findById(req.params.id).select("submittedBy hiddenFromPortal idNo status");
    if (!submission) return res.status(404).json({ message: "Submission not found" });
    if (String(submission.submittedBy || "").toLowerCase() !== String(user.email).toLowerCase()) {
      return res.status(403).json({ message: "You can only remove your own submissions." });
    }
    // A reverted submission is waiting on THIS user to correct and resubmit it, and
    // leaving it unresolved blocks their next submission. Hiding it would remove the
    // only way to reach it, so the action is refused with the reason. GET
    // /my-submissions lists reverted rows regardless of this flag, so the read and
    // the write agree rather than one silently overriding the other.
    if (String(submission.status || "") === "reverted") {
      return res.status(400).json({
        message:
          "This submission was reverted and needs your correction. Update and resubmit it — it cannot be removed from your history while it is reverted.",
      });
    }

    submission.hiddenFromPortal = true;
    await submission.save();

    writeLog("info", "portal.submission.hide", {
      message: `Portal user hid submission ${submission.idNo || submission._id} from their history`,
      user: user.email,
      ip: req.ip,
      meta: { submissionId: submission._id },
    });

    res.json({ message: "Removed from your history. EMB Region III still keeps this record." });
  } catch (error) {
    return sendPortalContextError(res, error);
  }
});

// Portal user dismisses one of their own "My Requests" entries. The underlying
// transaction (audit log) is retained — the user's email is added to
// portalHiddenBy so it stops appearing in their own list.
router.patch("/my-requests/:id/hide", async (req, res) => {
  try {
    // WRITE: read-only in developer context (see assertPortalWriteAllowed).
    const ctx = await resolvePortalContext(req);
    assertPortalWriteAllowed(ctx, req);
    const user = ctx.portalUser;

    const Transaction = require("../models/Transaction");
    const txn = await Transaction.findById(req.params.id).select("submittedBy performedBy portalHiddenBy");
    if (!txn) return res.status(404).json({ message: "Request not found" });

    const email = String(user.email).toLowerCase();
    const owns =
      String(txn.submittedBy || "").toLowerCase() === email ||
      String(txn.performedBy || "").toLowerCase() === email;
    if (!owns) {
      return res.status(403).json({ message: "You can only remove your own requests." });
    }

    if (!Array.isArray(txn.portalHiddenBy)) txn.portalHiddenBy = [];
    if (!txn.portalHiddenBy.includes(email)) {
      txn.portalHiddenBy.push(email);
      await txn.save();
    }

    res.json({ message: "Removed from your list." });
  } catch (error) {
    return sendPortalContextError(res, error);
  }
});

// Forgot Password — send 6-digit reset code
router.post("/forgot-password", async (req, res) => {
  try {
    if (await enforcePortalMaintenance(res)) return;

    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    // Checked BEFORE the account lookup, deliberately: when mail is globally
    // unusable every caller gets this same answer, so it reveals nothing about which
    // addresses are registered. Previously a broken mail setup still replied "a reset
    // code has been sent", leaving users waiting on an email that could never arrive.
    const deliverable = await isEmailDeliverable();
    if (!deliverable.ok) {
      writeLog("error", "portal.forgot-password.undeliverable", {
        message: `Password reset requested but no mail transport is usable (${deliverable.reason})`,
        ip: req.ip,
        meta: { reason: deliverable.reason },
      });
      return res.status(503).json({
        message:
          deliverable.reason === "maintenance"
            ? "Password recovery is paused while email is under maintenance. Please try again later, or email eswmr3@emb.gov.ph for help."
            : "Password recovery is temporarily unavailable because the email service is not reachable. Please email eswmr3@emb.gov.ph and an administrator will help you directly.",
        code: "email_unavailable",
      });
    }

    const user = await UserPortal.findOne({ email: email.toLowerCase() });
    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({ message: "If that email exists, a reset code has been sent." });
    }

    const resetCode = crypto.randomInt(100000, 999999).toString();
    user.resetToken = resetCode;
    user.resetTokenExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save();

    // Await delivery so failures are visible/diagnosable (email.js also logs
    // email.sent/email.failed). Anti-enumeration: return the same generic message
    // whether or not the mail actually went out.
    try {
      await sendPortalResetPasswordEmail(user.email, user.firstName, resetCode);
      writeLog("info", "portal.forgot-password", {
        message: `Password reset code sent: ${user.email}`,
        user: user.email,
        ip: req.ip,
      });
    } catch (emailErr) {
      console.error("Failed to send portal reset password email:", emailErr.message);
      writeLog("error", "portal.forgot-password.failed", {
        message: `Password reset code FAILED to send: ${user.email} — ${emailErr.message}`,
        user: user.email,
        ip: req.ip,
        meta: { error: emailErr.message },
      });
    }

    res.json({ message: "If that email exists, a reset code has been sent." });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Verify Reset Code
router.post("/verify-reset-code", async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ message: "Email and code are required" });
    }

    const user = await UserPortal.findOne({
      email: email.toLowerCase(),
      resetToken: code,
      resetTokenExpiry: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired code" });
    }

    res.json({ message: "Code verified" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Reset Password — verify code & update password
router.post("/reset-password", async (req, res) => {
  try {
    if (await enforcePortalMaintenance(res)) return;

    const { email, code, password } = req.body;
    if (!email || !code || !password) {
      return res.status(400).json({ message: "Email, code and new password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const user = await UserPortal.findOne({
      email: email.toLowerCase(),
      resetToken: code,
      resetTokenExpiry: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired reset code" });
    }

    user.password = password;
    user.resetToken = null;
    user.resetTokenExpiry = null;
    await user.save();

    writeLog("info", "portal.reset-password", {
      message: `Password reset completed: ${user.email}`,
      user: user.email,
      ip: req.ip,
    });

    res.json({ message: "Password has been reset successfully. You can now log in." });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Submit Verification Update — for held accounts to re-upload docs + update info
// Requires a valid portal JWT token.
// Request verification code before changing logged-in portal credentials
router.post("/credentials/request-code", async (req, res) => {
  try {
    if (await enforcePortalMaintenance(res)) return;

    const user = await getCredentialUpdateUser(req, res);
    if (!user) return;
    if (!ensureCredentialSelfServiceEnabled(user, res)) return;
    if (user.blocked) {
      return res.status(403).json({ message: user.blockedReason || "Portal account blocked" });
    }
    if (user.maintenanceMode) {
      return res.status(403).json({ message: user.maintenanceReason || "Portal account under maintenance" });
    }

    const { username, password } = req.body || {};
    const nextUsername = String(username || user.username || "").trim().toLowerCase();
    if (!nextUsername) return res.status(400).json({ message: "Username is required" });
    if (password && String(password).length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }
    const existing = await UserPortal.findOne({ username: nextUsername, _id: { $ne: user._id } });
    if (existing) return res.status(400).json({ message: "Username is already registered" });
    if ((user.username || "") === nextUsername && !password) {
      return res.status(400).json({ message: "Enter a new username or password before requesting a code" });
    }

    const resetCode = crypto.randomInt(100000, 999999).toString();
    user.resetToken = resetCode;
    user.resetTokenExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    sendPortalCustomEmail(user.email, {
      subject: "SLF Portal Credential Verification Code",
      firstName: user.firstName,
      message: `Use this verification code to update your SLF portal credentials: ${resetCode}\n\nThis code will expire in 10 minutes. If you did not request a credential update, please contact EMB Region III immediately.`,
    }).catch((emailErr) => {
      console.error("Failed to send portal credential verification code:", emailErr.message);
    });

    writeLog("info", "portal.credentials.request-code", {
      message: `Credential change code sent: ${user.email}`,
      user: user.email,
      ip: req.ip,
    });

    res.json({ message: "Verification code sent to your registered email." });
  } catch (error) {
    res.status(error.name === "JsonWebTokenError" ? 401 : 500).json({
      message: error.name === "JsonWebTokenError" ? "Invalid token" : "Server error",
      error: error.message,
    });
  }
});

// Verify code and update logged-in portal credentials
router.post("/credentials/update", async (req, res) => {
  try {
    if (await enforcePortalMaintenance(res)) return;

    const user = await getCredentialUpdateUser(req, res);
    if (!user) return;
    if (!ensureCredentialSelfServiceEnabled(user, res)) return;
    if (user.blocked) {
      return res.status(403).json({ message: user.blockedReason || "Portal account blocked" });
    }
    if (user.maintenanceMode) {
      return res.status(403).json({ message: user.maintenanceReason || "Portal account under maintenance" });
    }

    const { username, password, code } = req.body || {};
    const nextUsername = String(username || "").trim().toLowerCase();
    if (!nextUsername || !code) {
      return res.status(400).json({ message: "Username and verification code are required" });
    }
    if (password && String(password).length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }
    if (user.resetToken !== String(code).trim() || !user.resetTokenExpiry || user.resetTokenExpiry <= new Date()) {
      return res.status(400).json({ message: "Invalid or expired verification code" });
    }
    const existing = await UserPortal.findOne({ username: nextUsername, _id: { $ne: user._id } });
    if (existing) return res.status(400).json({ message: "Username is already registered" });
    if ((user.username || "") === nextUsername && !password) {
      return res.status(400).json({ message: "Enter a new username or password before saving credentials" });
    }

    const changed = [];
    if (user.username !== nextUsername) {
      user.username = nextUsername;
      changed.push("username");
    }
    if (password) {
      user.password = password;
      changed.push("password");
    }
    user.allowCredentialSelfService = false;
    user.resetToken = null;
    user.resetTokenExpiry = null;
    await user.save();

    await Notification.create({
      recipient: user.email,
      type: "portal_user_email",
      title: "Portal Credentials Updated",
      message: `Your SLF portal ${changed.join(" and ") || "credentials"} were updated successfully. Please log in again.`,
      meta: { portalUserId: user._id, portalUserEmail: user.email, changed },
    });

    writeLog("info", "portal.credentials.update", {
      message: `Portal credentials updated: ${user.email}`,
      user: user.email,
      ip: req.ip,
      meta: { changed },
    });

    res.json({ message: "Credentials updated. Please log in again." });
  } catch (error) {
    res.status(error.name === "JsonWebTokenError" ? 401 : 500).json({
      message: error.name === "JsonWebTokenError" ? "Invalid token" : "Server error",
      error: error.message,
    });
  }
});

router.post("/submit-verification", uploadSingle(upload, "verificationFile", { maxSizeMb: MAX_UPLOAD_MB }), async (req, res) => {
  try {
    // WRITE: a developer must never upload verification documents on behalf of a
    // portal user — that would forge an identity record under their name.
    const ctx = await resolvePortalContext(req);
    assertPortalWriteAllowed(ctx, req);
    const user = await UserPortal.findById(ctx.portalUser._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.verificationRequired) {
      return res.status(400).json({ message: "No verification update is required for this account." });
    }
    if (user.verificationSubmitted) {
      return res.status(400).json({ message: "Your verification documents are already submitted and awaiting admin review." });
    }
    if (!req.file) {
      return res.status(400).json({ message: "Please upload a verification attachment before submitting." });
    }

    const { officeEmail, pcoEmail } = req.body;

    // Upload new verification file if provided
    try {
      const storedFile = await saveVerificationAttachment(req, req.file, user.email, "portal.verification");
      user.verificationFileUrl = storedFile.url;
      user.verificationFileDriveId = storedFile.driveId;
      user.verificationFileType = storedFile.fileType;
    } catch (fileErr) {
      writeLog("error", "portal.verification.file", {
        message: `Verification file storage failed for ${user.email}: ${fileErr.message}`,
        user: user.email,
        ip: req.ip,
      });
      return res.status(500).json({ message: "File upload failed. Please try again." });
    }

    if (officeEmail) user.officeEmail = officeEmail.trim().toLowerCase();
    if (pcoEmail) user.pcoEmail = pcoEmail.trim().toLowerCase();
    user.verificationSubmitted = true;
    recordVerificationSubmission(user, {
      action: "submitted",
      note: "Re-verification attachment submitted for admin review",
      performedBy: user.email,
    });

    await user.save();

    // Notify admin that verification docs were submitted
    try {
      await Notification.create({
        recipient: "admin",
        type: "portal_verification_submitted",
        title: "Verification Documents Submitted",
        message: `${user.firstName} ${user.lastName} (${user.email}) has submitted their verification documents for review.`,
        meta: { email: user.email },
      });
      notifyAdmin(req, { type: "portal_verification_submitted", title: "Verification Docs Submitted", message: `${user.firstName} ${user.lastName} submitted verification docs` });
    } catch { /* silent */ }

    writeLog("info", "portal.verification.submit", {
      message: `Verification update submitted: ${user.email}`,
      user: user.email,
      ip: req.ip,
    });

    res.json({ message: "Verification information submitted. Please wait for admin review before accessing the portal." });
  } catch (error) {
    if (error.message?.includes("Unsupported file type")) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
// Exposed so utils/portalReadiness.js (which powers VERA's "what's still
// outstanding?" answers) reuses the SAME cell-placement rule rather than restating
// it — two copies of this would inevitably drift apart.
module.exports.summarizeCellAssignment = summarizeCellAssignment;
// Exposed for testing: the baseline fleet → capacity lookup that lets Organize
// Cells pre-fill a Truck Capacity the operator already declared.
module.exports.buildBaselineCapacityIndex = buildBaselineCapacityIndex;
