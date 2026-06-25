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
    // Best-effort activity location (browser geolocation if shared, else IP-derived)
    geo: {
      lat: { type: Number },
      lng: { type: Number },
      accuracy: { type: Number },
      city: { type: String, trim: true },
      region: { type: String, trim: true },
      country: { type: String, trim: true },
      label: { type: String, trim: true },
      source: { type: String, trim: true }, // "browser" | "ip" | "private"
    },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

// Auto-delete logs older than 30 days
appLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model("AppLog", appLogSchema, "app-logs");
