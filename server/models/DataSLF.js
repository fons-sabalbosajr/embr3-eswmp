const mongoose = require("mongoose");

const vehicleSchema = new mongoose.Schema(
  {
    plateNumber: { type: String, trim: true },
    vehicleType: { type: String, trim: true },
    capacity: { type: Number },
    capacityUnit: { type: String, enum: ["tons", "m³", "m3"], default: "m³" },
  },
  { _id: false }
);

const truckSchema = new mongoose.Schema(
  {
    disposalTicketNo: { type: String, trim: true },
    hauler: { type: String, trim: true },
    plateNumber: { type: String, trim: true },
    truckCapacity: { type: Number },
    truckCapacityUnit: { type: String, enum: ["tons", "m³", "m3"], default: "m³" },
    vehicles: [vehicleSchema],
    actualVolume: { type: Number },
    actualVolumeUnit: { type: String, enum: ["tons", "m³", "m3"], default: "tons" },
    wasteType: { type: String, enum: ["Residual", "Hazardous Waste", "Treated Hazardous Waste"] },
    hazWasteCode: [{ type: String, trim: true }],
  },
  { _id: false }
);

const haulerSchema = new mongoose.Schema(
  {
    haulerName: { type: String, trim: true },
    numberOfTrucks: { type: Number },
    officeAddress: { type: String, trim: true },
    // Legacy single-vehicle fields (kept for backward compatibility)
    plateNumber: { type: String, trim: true },
    vehicleType: { type: String, trim: true },
    capacity: { type: Number },
    capacityUnit: { type: String, enum: ["tons", "m³", "m3"], default: "m³" },
    // Multi-vehicle entries
    vehicles: [vehicleSchema],
    privateSectorClients: [{ type: String, trim: true }],
  },
  { _id: false }
);

const dataSLFSchema = new mongoose.Schema(
  {
    slfGenerator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SlfFacility",
    },
    slfName: { type: String, trim: true },
    submissionId: { type: String, trim: true },
    idNo: { type: String, trim: true },

    // Cell Operations
    currentCellVolume: { type: Number },
    currentCellVolumeUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    cellStatus: { type: String, enum: ["Active", "Closed"], default: "Active" },

    // Baseline Information
    baselineUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    totalVolumeAccepted: { type: Number },
    totalVolumeAcceptedUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    activeCellResidualVolume: { type: Number },
    activeCellResidualUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    activeCellInertVolume: { type: Number },
    activeCellInertUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    activeCellHazardousVolume: { type: Number },
    activeCellHazardousUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    closedCellResidualVolume: { type: Number },
    closedCellResidualUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    closedCellInertVolume: { type: Number },
    closedCellInertUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    closedCellHazardousVolume: { type: Number },
    closedCellHazardousUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    acceptsHazardousWaste: { type: Boolean, default: false },
    accreditedHaulers: [haulerSchema],
    // Baseline update approval
    baselineUpdateRequested: { type: Boolean, default: false },
    baselineUpdateRequestedAt: { type: Date },
    baselineUpdateRequestReason: { type: String, trim: true },
    baselineUpdateApproved: { type: Boolean, default: false },
    baselineUpdateApprovedAt: { type: Date },
    baselineUpdateApprovedBy: { type: String, trim: true },

    dateOfDisposal: { type: Date, required: true },
    lguCompanyName: { type: String, required: true, trim: true },
    companyType: {
      type: String,
      enum: ["LGU", "Private"],
      required: true,
    },
    address: { type: String, trim: true },

    // Company Information (Basic Info tab)
    companyRegion: { type: String, trim: true },
    companyProvince: { type: String, trim: true },
    companyMunicipality: { type: String, trim: true },
    companyBarangay: { type: String, trim: true },

    trucks: [truckSchema],
    status: {
      type: String,
      enum: ["pending", "acknowledged", "rejected", "revert_requested", "reverted"],
      default: "pending",
    },
    revertRequested: { type: Boolean, default: false },
    revertReason: { type: String, trim: true },
    revertRequestedAt: { type: Date },
    revertedBy: { type: String, trim: true },
    revertedAt: { type: Date },
    submittedBy: { type: String, trim: true },
    // Soft delete
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

// Province code mapping for ID generation
const PROVINCE_CODES = {
  aurora: "AU",
  bataan: "BA",
  bulacan: "BU",
  "nueva ecija": "NE",
  nueva_ecija: "NE",
  pampanga: "PA",
  tarlac: "TA",
  zambales: "ZA",
};

function getProvinceCode(province) {
  if (!province) return "XX";
  const key = province.toLowerCase().replace(/^province of\s+/i, "").trim();
  return PROVINCE_CODES[key] || province.substring(0, 2).toUpperCase();
}

// Auto-generate the ID No based on province of the SLF
dataSLFSchema.pre("save", async function () {
  if (this.isNew && !this.idNo) {
    const DataSLF = mongoose.model("DataSLF");
    const SlfFacility = mongoose.model("SlfFacility");

    // Resolve province from linked SLF facility
    let province = "";
    if (this.slfGenerator) {
      const facility = await SlfFacility.findById(this.slfGenerator).select("province");
      if (facility) province = facility.province;
    }
    const provCode = getProvinceCode(province);

    const typeCode =
      this.companyType === "Private"
        ? "PVT"
        : this.companyType === "LGU"
        ? "LGU"
        : "OTH";

    // Count existing docs with same province code and type to get next sequence
    const pattern = new RegExp(`^SLF-${typeCode}-${provCode}-`);
    const lastDoc = await DataSLF.findOne({ idNo: pattern }).sort({ idNo: -1 });
    let seq = 1;
    if (lastDoc && lastDoc.idNo) {
      const parts = lastDoc.idNo.split("-");
      const lastNum = parseInt(parts[3], 10);
      if (!isNaN(lastNum)) seq = lastNum + 1;
    }
    this.idNo = `SLF-${typeCode}-${provCode}-${String(seq).padStart(4, "0")}`;
  }
});

module.exports = mongoose.model("DataSLF", dataSLFSchema, "data-slf");
