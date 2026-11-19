const mongoose = require("mongoose");

// Planning Unit Access — a time-limited, VIEW-ONLY way into the SLF Portal for EMB
// Region III's Planning Unit, modelled on the Developer Portal access (username +
// password + PIN, then pick a portal account) but issued to a non-developer.
//
// Kept in its OWN collection, not on AppSettings: GET /settings/app is public and
// PUT /settings/app is open to every admin, so anything stored there is one
// serialisation away from leaking or being overwritten. This document is only ever
// read by routes/planningUnit.js, and its hashes never leave the server.
//
// A single document (the access is one shared credential for the unit).
const planningUnitAccessSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    username: { type: String, trim: true, lowercase: true, default: "" },
    passwordHash: { type: String, default: "" },
    pinHash: { type: String, default: "" },
    // Access stops at this instant: no new sign-in, and every open session is
    // refused on its next request. Default: end of Dec 31, 2026, Philippine time.
    validUntil: { type: Date, default: () => new Date("2026-12-31T23:59:59+08:00") },
    // Bumped by "End all sessions" and by every credential change, so a token
    // issued before the change stops working at once.
    sessionVersion: { type: Number, default: 1 },
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
    lastViewedPortalUser: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true, collection: "planning_unit_access" },
);

planningUnitAccessSchema.statics.getSingleton = async function getSingleton() {
  let doc = await this.findOne();
  if (!doc) doc = await this.create({});
  return doc;
};

module.exports = mongoose.model("PlanningUnitAccess", planningUnitAccessSchema);
