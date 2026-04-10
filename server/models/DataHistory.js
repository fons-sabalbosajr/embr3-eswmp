const mongoose = require("mongoose");

const provinceBreakdownSchema = new mongoose.Schema(
  {
    province: String,
    count: Number,
  },
  { _id: false }
);

const statusBreakdownSchema = new mongoose.Schema(
  {
    status: String,
    count: Number,
  },
  { _id: false }
);

const dataHistorySchema = new mongoose.Schema(
  {
    year: { type: Number, required: true, index: true },
    category: {
      type: String,
      required: true,
      enum: [
        "tenYearPlan",
        "fundedMrf",
        "lguMrf",
        "slf",
        "trashTraps",
        "swmEquipment",
        "residualContainment",
        "transferStation",
        "openDumpsite",
        "fundedRehab",
      ],
      index: true,
    },
    totalRecords: { type: Number, default: 0 },
    byProvince: [provinceBreakdownSchema],
    byStatus: [statusBreakdownSchema],
    // Optional additional breakdowns depending on category
    additionalMetrics: { type: mongoose.Schema.Types.Mixed, default: {} },
    source: {
      type: String,
      enum: ["excel", "system"],
      default: "excel",
    },
  },
  { timestamps: true }
);

dataHistorySchema.index({ year: 1, category: 1 }, { unique: true });

module.exports = mongoose.model("DataHistory", dataHistorySchema);
