const mongoose = require("mongoose");

const accreditedHaulerSchema = new mongoose.Schema({
  haulerName: { type: String, required: true, trim: true },
  numberOfTrucks: { type: Number, default: 0 },
  privateSectorClients: { type: String, trim: true },
});

const slfGeneratorSchema = new mongoose.Schema(
  {
    slfName: { type: String, required: true, trim: true },
    /* Baseline / Profile Info */
    existingBaselineVolume: { type: Number, default: 0 },
    existingBaselineUnit: { type: String, enum: ["tons", "m3"], default: "tons" },
    totalVolumeSinceOperation: { type: Number, default: 0 },
    totalVolumeSinceOperationUnit: { type: String, enum: ["tons", "m3"], default: "tons" },
    totalVolumeActiveCells: { type: Number, default: 0 },
    totalVolumeActiveCellsUnit: { type: String, enum: ["tons", "m3"], default: "tons" },
    totalVolumeClosedCells: { type: Number, default: 0 },
    totalVolumeClosedCellsUnit: { type: String, enum: ["tons", "m3"], default: "tons" },
    /* Accredited Haulers */
    accreditedHaulers: [accreditedHaulerSchema],
    /* Status */
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SLFGenerator", slfGeneratorSchema, "slfgenerators");
