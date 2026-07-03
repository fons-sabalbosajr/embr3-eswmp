const express = require("express");
const UserPortal = require("../models/UserPortal");
const SlfFacility = require("../models/SlfFacility");
const { authMiddleware, developerOnly } = require("../middleware/auth");
const { writeLog } = require("../utils/logger");
const { ensureDummyCellInfrastructure } = require("../utils/dummyCells");

const router = express.Router();

// Dummy Account / Dummy SLF configuration is developer-only. Non-developer
// admins (and portal users) are blocked at the API layer, not just the UI.
router.use(authMiddleware, developerOnly, (req, _res, next) => {
  req.logUser = req.user?.email || req.user?.username || req.user?.id || "";
  next();
});

/* ────────────────────────────── Dummy Portal Users ───────────────────────── */

// List dummy/test portal user accounts
router.get("/portal-users", async (_req, res) => {
  try {
    const users = await UserPortal.find({ isDummy: true })
      .select("-password")
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Create a dummy portal user
router.post("/portal-users", async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      contactNumber = "",
      companyName = "",
      assignedSlfName = [],
    } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res
        .status(400)
        .json({ message: "First name, last name, email, and password are required." });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    const existing = await UserPortal.findOne({ email: String(email).toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ message: "A portal user with this email already exists." });
    }

    const user = new UserPortal({
      firstName,
      lastName,
      email,
      password,
      contactNumber,
      companyName,
      assignedSlfName: Array.isArray(assignedSlfName) ? assignedSlfName : [],
      isDummy: true,
      status: "approved",
      isVerified: true,
      approvedAt: new Date(),
    });
    await user.save();

    const safe = user.toObject();
    delete safe.password;
    res.status(201).json({ message: "Dummy portal user created.", data: safe });
    writeLog("info", "dummy.portal-user.create", {
      message: `Dummy portal user created: ${user.email}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update a dummy portal user (guards against editing real accounts)
router.put("/portal-users/:id", async (req, res) => {
  try {
    const user = await UserPortal.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found." });
    if (!user.isDummy) {
      return res
        .status(403)
        .json({ message: "This is a real portal account and cannot be edited here." });
    }

    const { firstName, lastName, contactNumber, companyName, password, assignedSlfName } =
      req.body;
    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (contactNumber !== undefined) user.contactNumber = contactNumber;
    if (companyName !== undefined) user.companyName = companyName;
    if (assignedSlfName !== undefined) {
      user.assignedSlfName = Array.isArray(assignedSlfName) ? assignedSlfName : [];
    }
    if (password) {
      if (String(password).length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters." });
      }
      user.password = password; // re-hashed by pre-save hook
    }
    await user.save();

    const safe = user.toObject();
    delete safe.password;
    res.json({ message: "Dummy portal user updated.", data: safe });
    writeLog("info", "dummy.portal-user.update", {
      message: `Dummy portal user updated: ${user.email}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete a dummy portal user (only dummy accounts)
router.delete("/portal-users/:id", async (req, res) => {
  try {
    const user = await UserPortal.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found." });
    if (!user.isDummy) {
      return res
        .status(403)
        .json({ message: "This is a real portal account and cannot be deleted here." });
    }
    await user.deleteOne();
    res.json({ message: "Dummy portal user deleted." });
    writeLog("warn", "dummy.portal-user.delete", {
      message: `Dummy portal user deleted: ${user.email}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Mark an existing real account as dummy, or unmark a dummy account.
// Used to "move" pre-existing test accounts out of the Portal Users list.
// Converting to/from dummy CLEARS any existing SLF assignment so a dummy account
// can never keep a real facility (and vice versa). The account must then be
// (re)assigned an appropriate facility.
router.patch("/portal-users/:id/mark", async (req, res) => {
  try {
    const { isDummy } = req.body;
    const makeDummy = isDummy === true;
    const user = await UserPortal.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found." });

    const hadAssignment = Array.isArray(user.assignedSlf) && user.assignedSlf.length > 0;
    user.isDummy = makeDummy;
    // Clear the previous facility link so dummy↔real conversions never mix data.
    user.assignedSlf = [];
    user.assignedSlfName = [];
    await user.save();

    const safe = user.toObject();
    delete safe.password;
    res.json({
      message: makeDummy
        ? "Account moved to Dummy Data. Assign a dummy SLF facility to it."
        : "Account restored to Portal Users. Re-assign a real SLF facility via Portal User Management.",
      data: safe,
    });
    writeLog("info", "dummy.portal-user.mark", {
      message: `Portal user ${user.email} isDummy=${user.isDummy}; prior facility assignment cleared=${hadAssignment}`,
      user: req.logUser,
      ip: req.ip,
      meta: { userId: user._id, isDummy: user.isDummy, clearedAssignment: hadAssignment },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

/* ───────────────────────────── Dummy SLF Facilities ──────────────────────── */

// List dummy/test SLF facility records
router.get("/slf-facilities", async (_req, res) => {
  try {
    const records = await SlfFacility.find({ isDummy: true, deletedAt: null }).sort({
      createdAt: -1,
    });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Create a dummy SLF facility for demo/testing
router.post("/slf-facilities", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.lgu && !body.province) {
      return res.status(400).json({ message: "At least an LGU or Province is required." });
    }
    const record = new SlfFacility({
      ...body,
      isDummy: true, // force dummy regardless of payload
      deletedAt: null,
    });
    ensureDummyCellInfrastructure(record);
    await record.save();
    res.status(201).json({ message: "Dummy SLF facility created.", data: record });
    writeLog("info", "dummy.slf.create", {
      message: `Dummy SLF facility created: ${record.lgu || record.province}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Edit a dummy SLF facility (developer-only; only dummy records). Accepts the
// same fields as the real SLF facility model so developers can build realistic
// dummy facilities (profile, cells, baseline, permits, leachate/gas, etc.).
router.put("/slf-facilities/:id", async (req, res) => {
  try {
    const record = await SlfFacility.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "SLF record not found." });
    if (!record.isDummy) {
      return res.status(403).json({ message: "This is a real SLF record and cannot be edited here." });
    }
    const body = req.body || {};
    // Never allow flipping the dummy flag or resurrecting a soft-deleted record here.
    delete body.isDummy;
    delete body._id;
    Object.assign(record, body);
    record.isDummy = true;
    ensureDummyCellInfrastructure(record);
    await record.save();
    res.json({ message: "Dummy SLF facility updated.", data: record });
    writeLog("info", "dummy.slf.update", {
      message: `Dummy SLF facility updated: ${record.lgu || record.province}`,
      user: req.logUser,
      ip: req.ip,
      meta: { facilityId: record._id },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete a dummy SLF facility (only dummy records)
router.delete("/slf-facilities/:id", async (req, res) => {
  try {
    const record = await SlfFacility.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "SLF record not found." });
    if (!record.isDummy) {
      return res
        .status(403)
        .json({ message: "This is a real SLF record and cannot be deleted here." });
    }
    await record.deleteOne();
    res.json({ message: "Dummy SLF facility deleted." });
    writeLog("warn", "dummy.slf.delete", {
      message: `Dummy SLF facility deleted: ${record.lgu || record.province}`,
      user: req.logUser,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

/* ─────────────────────── Dummy Account ⇄ Dummy Facility ───────────────────── */

function facilityDisplayName(facility) {
  return `${facility.lgu || facility.province || "Dummy SLF"}${facility.ownership ? ` (${facility.ownership})` : ""}`;
}

// Assign (or reassign) a dummy portal account to a dummy SLF facility. Enforces
// the invariant that dummy accounts only ever link to dummy facilities so test
// data can never point at production records.
router.post("/portal-users/:id/assign-facility", async (req, res) => {
  try {
    const { facilityId } = req.body || {};
    if (!facilityId) return res.status(400).json({ message: "facilityId is required." });

    const user = await UserPortal.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found." });
    if (!user.isDummy) {
      return res.status(403).json({ message: "Only dummy accounts can be assigned here." });
    }

    const facility = await SlfFacility.findById(facilityId);
    if (!facility) return res.status(404).json({ message: "SLF facility not found." });
    if (!facility.isDummy) {
      return res.status(400).json({
        message: "A dummy account can only be assigned to a dummy SLF facility.",
      });
    }

    user.assignedSlf = [facility._id];
    user.assignedSlfName = [facilityDisplayName(facility)];
    await user.save();

    const safe = user.toObject();
    delete safe.password;
    res.json({ message: "Dummy facility assigned.", data: safe });
    writeLog("info", "dummy.portal-user.assign", {
      message: `Dummy account ${user.email} assigned to dummy facility ${facilityDisplayName(facility)}`,
      user: req.logUser,
      ip: req.ip,
      meta: { userId: user._id, facilityId: facility._id },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Remove a dummy account's facility assignment.
router.post("/portal-users/:id/unassign-facility", async (req, res) => {
  try {
    const user = await UserPortal.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found." });
    if (!user.isDummy) {
      return res.status(403).json({ message: "Only dummy accounts can be modified here." });
    }
    user.assignedSlf = [];
    user.assignedSlfName = [];
    await user.save();
    const safe = user.toObject();
    delete safe.password;
    res.json({ message: "Facility unassigned.", data: safe });
    writeLog("info", "dummy.portal-user.unassign", {
      message: `Dummy account ${user.email} facility unassigned`,
      user: req.logUser,
      ip: req.ip,
      meta: { userId: user._id },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
