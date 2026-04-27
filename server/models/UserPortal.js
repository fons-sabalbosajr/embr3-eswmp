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
    password: { type: String, required: true, minlength: 6 },
    contactNumber: { type: String, trim: true, default: "" },
    companyName: { type: String, trim: true, default: "" },
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
    // Admin-triggered re-verification flow
    verificationRequired: { type: Boolean, default: false },
    verificationSubmitted: { type: Boolean, default: false }, // user has re-submitted docs
    // Password reset
    resetToken: { type: String, default: null },
    resetTokenExpiry: { type: Date, default: null },
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
