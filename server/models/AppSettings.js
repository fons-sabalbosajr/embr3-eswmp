const mongoose = require("mongoose");

const appSettingsSchema = new mongoose.Schema(
  {
    // General
    appName: { type: String, default: "EMBR3 ESWMP" },
    appDescription: { type: String, default: "Ecological Solid Waste Management Pipeline" },

    // Theme
    theme: { type: String, enum: ["light", "dark"], default: "light" },
    primaryColor: { type: String, default: "#1a3353" },
    sidebarStyle: { type: String, enum: ["gradient", "solid"], default: "gradient" },
    siderColor: { type: String, default: "#1a3353" },
    siderColorDark: { type: String, default: "#111927" },
    headerColor: { type: String, default: "#ffffff" },
    headerColorDark: { type: String, default: "#141414" },

    // Portal
    portalTitle: { type: String, default: "SLF Generators Portal" },
    portalSubtitle: { type: String, default: "Ecological Solid Waste Management Pipeline (ESWMP) — Sanitary Landfill Monitoring System" },
    portalEnabled: { type: Boolean, default: true },
    requireEmailOnSubmit: { type: Boolean, default: true },

    // Email
    emailNotificationsEnabled: { type: Boolean, default: true },
    emailFrom: { type: String, default: "" },

    // Security
    sessionTimeout: { type: Number, default: 7 },        // days
    maxLoginAttempts: { type: Number, default: 5 },
    allowSignup: { type: Boolean, default: true },
    defaultRole: { type: String, enum: ["developer", "admin", "user"], default: "admin" },

    // Maintenance
    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: { type: String, default: "System is under maintenance. Please try again later." },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AppSettings", appSettingsSchema);
