const mongoose = require("mongoose");

const appLogSchema = new mongoose.Schema(
  {
    level: {
      type: String,
      enum: ["info", "warn", "error"],
      default: "info",
    },
    action: { type: String, required: true, trim: true },
    message: { type: String, trim: true },
    user: { type: String, trim: true },
    ip: { type: String, trim: true },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

// Auto-delete logs older than 30 days
appLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model("AppLog", appLogSchema, "app-logs");
