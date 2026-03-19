const mongoose = require("mongoose");

const portalFieldSchema = new mongoose.Schema(
  {
    fieldName: { type: String, required: true, trim: true },
    fieldKey: { type: String, required: true, unique: true, trim: true },
    fieldType: {
      type: String,
      enum: ["text", "number", "date", "select", "textarea"],
      default: "text",
    },
    options: [String],
    required: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    section: {
      type: String,
      enum: [
        "disposal-info",
        "company-info",
        "transport-info",
        "hazwaste-codes",
      ],
      default: "disposal-info",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PortalField", portalFieldSchema);
