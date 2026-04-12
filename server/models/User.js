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
    permissions: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        dashboard: { view: true, edit: true, delete: true },
        submissions: { view: true, edit: true, delete: true },
        slfMonitoring: { view: true, edit: true, delete: true },
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
        portalFields: { view: true, edit: true, delete: true },
        dataReferences: { view: true, edit: true, delete: true },
      }),
    },
    isVerified: { type: Boolean, default: false },
    isApproved: { type: Boolean, default: false },
    resetToken: { type: String },
    resetTokenExpiry: { type: Date },
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
