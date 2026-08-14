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

// Auto-delete logs older than 30 days. This index also serves the plain
// newest-first sort, in either direction.
appLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

// The three filters the System & Logs view actually pages by, each paired with
// the sort key so the query is served from the index instead of a blocking
// in-memory sort. Deliberately only three: `message` and `geo.*` are searched by
// regex, which no index can serve, and adding more would cost write throughput
// on a collection that takes an insert on virtually every request.
appLogSchema.index({ level: 1, createdAt: -1 });
appLogSchema.index({ user: 1, createdAt: -1 });
appLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model("AppLog", appLogSchema, "app-logs");
