const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userPortalSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    username: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true, minlength: 6 },
    contactNumber: { type: String, trim: true, default: "" },
    companyName: { type: String, trim: true, default: "" },
    // Profile picture (routes/profilePhoto.js) — same shape as User.profilePhoto.
    profilePhoto: {
      url: { type: String, default: "" },
      storage: { type: String, enum: ["", "drive", "local"], default: "" },
      fileRef: { type: String, default: "" },
      updatedAt: { type: Date, default: null },
    },
    // Marks demo/test accounts created via Developer Settings > Dummy Data
    // Configuration so they can be filtered separately from real portal users.
    isDummy: { type: Boolean, default: false, index: true },
    // Marks the sealed portal demonstration account. Distinct from `isDummy`:
    // `isDummy` isolates DATA from analytics/reports (already enforced across
    // dataSLF.js), while `isDemo` marks the ACCOUNT so it is hidden from Portal
    // User Management and its session renders masked values. The demo account
    // carries BOTH — see utils/demoMode.js.
    isDemo: { type: Boolean, default: false, index: true },
    // Assigned SLF (set by admin during approval) — supports multiple
    assignedSlf: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SlfFacility",
      },
    ],
    assignedSlfName: [{ type: String, trim: true }],
    // Account status
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: { type: Date, default: null },
    rejectedReason: { type: String, trim: true, default: "" },
    isVerified: { type: Boolean, default: false },
    // Additional contact info
    officeEmail: { type: String, trim: true, lowercase: true, default: "" },
    pcoEmail: { type: String, trim: true, lowercase: true, default: "" },
    // Verification document (uploaded to Google Drive)
    verificationFileUrl: { type: String, default: "" },
    verificationFileDriveId: { type: String, default: "" },
    verificationFileType: { type: String, default: "" }, // "image" | "document"
    verificationSubmissionHistory: [
      {
        fileUrl: { type: String, default: "" },
        fileDriveId: { type: String, default: "" },
        fileType: { type: String, default: "" },
        officeEmail: { type: String, trim: true, lowercase: true, default: "" },
        pcoEmail: { type: String, trim: true, lowercase: true, default: "" },
        action: { type: String, enum: ["submitted", "archived", "reviewed"], default: "submitted" },
        note: { type: String, trim: true, default: "" },
        performedBy: { type: String, trim: true, default: "" },
        submittedAt: { type: Date, default: Date.now },
      },
    ],
    // Admin-triggered re-verification flow
    verificationRequired: { type: Boolean, default: false },
    verificationSubmitted: { type: Boolean, default: false }, // user has re-submitted docs
    // Admin security controls
    blocked: { type: Boolean, default: false },
    blockedReason: { type: String, trim: true, default: "" },
    blockedAt: { type: Date, default: null },
    blockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    maintenanceMode: { type: Boolean, default: false },
    maintenanceReason: { type: String, trim: true, default: "" },
    maintenanceAt: { type: Date, default: null },
    allowCredentialSelfService: { type: Boolean, default: false },
    securityWarningCount: { type: Number, default: 0 },
    lastSecurityWarningAt: { type: Date, default: null },
    // Activity-location tracing (opt-in browser geolocation)
    locationSharingEnabled: { type: Boolean, default: false },
    lastKnownLocation: {
      lat: { type: Number },
      lng: { type: Number },
      accuracy: { type: Number },
      label: { type: String, trim: true },
      updatedAt: { type: Date },
    },
    // Presence tracking — updated on portal activity to derive online/offline.
    lastActiveAt: { type: Date, default: null },
    // Admin-managed portal access control (per-user feature & cell access).
    // Extended with developer-configurable portal rules — see utils/portalPolicy.js,
    // the single source of truth for rule keys, defaults, and enforcement. Legacy
    // fields (canSubmitDisposal/canEditBaseline/canUploadExcel) are kept and mapped
    // to rule keys so users configured before this feature keep their behavior.
    // A field left undefined falls back to the catalog default in portalPolicy —
    // NOT to the schema default — so "unset" means "use policy default".
    portalAccess: {
      canSubmitDisposal: { type: Boolean, default: true },
      canEditBaseline: { type: Boolean, default: true },
      canUploadExcel: { type: Boolean, default: true },
      // Developer-configurable rules (default resolved by portalPolicy when unset).
      canChangeGlobalUnit: { type: Boolean },   // default false (developer-only)
      canEditSubmitted: { type: Boolean },       // default true
      canDeleteSubmitted: { type: Boolean },     // default true
      canReopenClosed: { type: Boolean },        // default false
      canManageCells: { type: Boolean },         // default true
      canCreateTickets: { type: Boolean },       // default true
      canViewVera: { type: Boolean },            // default true
      canAccessReports: { type: Boolean },       // default true
      // Restrict which disposal cells this user may dispose into.
      // Empty array => no restriction (all admin-allowed open cells available).
      // Stored as cell value labels, e.g. "Cell 1".
      allowedCells: [{ type: String, trim: true }],
      updatedAt: { type: Date, default: null },
      updatedBy: { type: String, trim: true, default: "" },
    },
    // Password reset
    resetToken: { type: String, default: null },
    resetTokenExpiry: { type: Date, default: null },
    // "Do not show again" for the VERA introduction. Stored server-side because
    // logout wipes localStorage (secureStorage.clearAll), which silently discarded
    // the opt-out and made the intro reappear on the next login.
    veraOnboardingDismissedAt: { type: Date, default: null },
    // "Don't show again" for the What's New guided tour (antd Tour on the portal
    // home). Here for exactly the same reason as the field above: the dismissal
    // was kept only in localStorage under a per-email key, and portal logout calls
    // secureStorage.clearAll() → localStorage.clear(). The user dismissed the tour,
    // logged out, and it greeted them again on the next sign-in — every time.
    // Server-side, it also follows them to another browser or device.
    portalTourDismissedAt: { type: Date, default: null },
    // Which portal announcement the user dismissed, identified by its VERSION
    // (updatedAt / id / title — the same value the portal derives).
    //
    // Deliberately a version, not a boolean. "Dismissed" has to mean "I have read
    // THIS announcement", because a global flag would silently suppress every
    // future announcement the admin publishes — the banner is how portal users
    // are told about maintenance windows and rollouts, so muting it permanently
    // would be worse than the reappearing banner this replaces. A new
    // announcement gets a new version and shows again.
    portalAnnouncementDismissedVersion: { type: String, trim: true, default: null },
    portalAnnouncementDismissedAt: { type: Date, default: null },
    // Which FEATURE tour the user has seen, identified by its release version.
    //
    // A version for the same reason the announcement is one, and pointedly NOT
    // the `portalTourDismissedAt` boolean above: that flag means "I have seen
    // the portal orientation", so reusing it would hide every future feature
    // tour from everyone who ever dismissed the orientation — including a
    // release that changes how they do their job. Each release bumps
    // PORTAL_FEATURE_TOUR_VERSION and the tour returns exactly once.
    portalFeatureTourVersionSeen: { type: String, trim: true, default: null },
    portalFeatureTourSeenAt: { type: Date, default: null },
    // "Don't show this again" — the BUTTON, not the version marker above.
    //
    // The two are different promises and were being served by one field. The
    // version marker means "this release has been seen", which is right for
    // finishing the tour or closing it: the next release is new information and
    // should be offered once. The button says *never*, and a user who clicks it
    // and is shown the tour again after the next deploy was told something
    // untrue. Two accounts hit exactly that — their marker moved from
    // 2026-08-20-hauler-bulk-clients to 2026-08-25-uploads-baseline-completeness
    // having already asked not to see it.
    //
    // So the opt-out is its own flag, permanent and version-independent. What's
    // New still reopens the tour on demand, for the same reason the orientation
    // tour's dismissal does not disable its button: an opt-out must not be a
    // one-way door.
    portalFeatureTourOptOutAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "user_portal" }
);

// Hash password before saving
userPortalSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
userPortalSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("UserPortal", userPortalSchema);
