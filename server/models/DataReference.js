const mongoose = require("mongoose");

const dataReferenceSchema = new mongoose.Schema(
  {
    category: { type: String, required: true, unique: true, trim: true },
    label: { type: String, required: true, trim: true },
    module: { type: String, required: true, trim: true },
    values: [{ type: String, trim: true }],
    description: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("DataReference", dataReferenceSchema);
