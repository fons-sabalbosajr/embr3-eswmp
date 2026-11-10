const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    username: { type: String, trim: true, default: "", sparse: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    role: { type: String, enum: ["developer", "admin", "user"], default: "user" },
    position: { type: String, trim: true, default: "" },
    designation: { type: String, trim: true, default: "" },
    // Profile picture (routes/profilePhoto.js). Stored privately in Google Drive
    // (images folder › "Profile Pictures"), or encrypted locally when Drive is
    // unavailable; `url` is a server-signed proxy URL an <img> can load.
    profilePhoto: {
      url: { type: String, default: "" },
      storage: { type: String, enum: ["", "drive", "local"], default: "" },
      fileRef: { type: String, default: "" }, // Drive file id or local file name
      updatedAt: { type: Date, default: null },
    },
    permissions: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        dashboard: { view: true, edit: true, delete: true },
        submissions: { view: true, edit: true, delete: true },
        sanitaryLandfills: { view: true, edit: true, delete: true },
        slfMonitoring: { view: true, edit: true, delete: true },
        slfClients: { view: true, edit: true, delete: true },
        region3Lgu: { view: true, edit: true, delete: true },
        messaging: { view: true, edit: true, delete: true },
        reports: { view: true, edit: true, delete: true },
        tenYearSwm: { view: true, edit: true, delete: true },
        fundedMrf: { view: true, edit: true, delete: true },
        lguInitiatedMrf: { view: true, edit: true, delete: true },
        trashTraps: { view: true, edit: true, delete: true },
        swmEquipment: { view: true, edit: true, delete: true },
        technicalAssistance: { view: true, edit: true, delete: true },
        transferStations: { view: true, edit: true, delete: true },
        openDumpsites: { view: true, edit: true, delete: true },
        projectDescScoping: { view: true, edit: true, delete: true },
        residualContainment: { view: true, edit: true, delete: true },
        lguAssistDiversion: { view: true, edit: true, delete: true },
        accountSettings: { view: true, edit: true, delete: true },
        portalUsers: { view: true, edit: true, delete: true },
        portalData: { view: true, edit: true, delete: true },
        portalUserEmail: { view: true, edit: true, delete: true },
        portalFields: { view: true, edit: true, delete: true },
        dataReferences: { view: true, edit: true, delete: true },
        baselineData: { view: true, edit: true, delete: true },
        orgChart: { view: true, edit: true, delete: true },
        supportTickets: { view: true, edit: true, delete: true },
        notificationManagement: { view: true, edit: true, delete: true },
        developerSettings: { view: true, edit: true, delete: true },
      }),
    },
    isVerified: { type: Boolean, default: false },
    isApproved: { type: Boolean, default: false },
    // Marks the sealed demonstration account used for stakeholder presentations.
    // This flags the ACCOUNT, not data: it hides the account from user-management
    // lists and switches the session into masked (demo) mode. The demo account's
    // DATA is isolated separately via the existing `isDummy` flag, which every
    // analytics/report/dashboard query already excludes — see utils/demoMode.js.
    isDemo: { type: Boolean, default: false, index: true },
    resetToken: { type: String },
    resetTokenExpiry: { type: Date },
    // "Do not show again" for the VERA introduction. Stored server-side because
    // logout wipes localStorage (secureStorage.clearAll), which silently discarded
    // the opt-out and made the intro reappear on the next login.
    veraOnboardingDismissedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
