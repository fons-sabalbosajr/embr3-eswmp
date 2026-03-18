const mongoose = require("mongoose");

const truckSchema = new mongoose.Schema(
  {
    disposalTicketNo: { type: String, trim: true },
    hauler: { type: String, trim: true },
    plateNumber: { type: String, trim: true },
    truckCapacity: { type: Number },
    truckCapacityUnit: { type: String, enum: ["tons", "m³", "m3"], default: "m³" },
    actualVolume: { type: Number },
    actualVolumeUnit: { type: String, enum: ["tons", "m³", "m3"], default: "tons" },
    wasteType: { type: String, enum: ["Residual", "Hazardous Waste"] },
  },
  { _id: false }
);

const haulerSchema = new mongoose.Schema(
  {
    haulerName: { type: String, trim: true },
    numberOfTrucks: { type: Number },
    privateSectorClients: { type: String, trim: true },
  },
  { _id: false }
);

const dataSLFSchema = new mongoose.Schema(
  {
    slfGenerator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SLFGenerator",
    },
    submissionId: { type: String, trim: true },
    idNo: { type: String, trim: true },

    // Baseline Information
    totalVolumeAccepted: { type: Number },
    totalVolumeAcceptedUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    activeCellResidualVolume: { type: Number },
    activeCellResidualUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    activeCellInertVolume: { type: Number },
    activeCellInertUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    closedCellResidualVolume: { type: Number },
    closedCellResidualUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    closedCellInertVolume: { type: Number },
    closedCellInertUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    accreditedHaulers: [haulerSchema],

    dateOfDisposal: { type: Date, required: true },
    lguCompanyName: { type: String, required: true, trim: true },
    companyType: {
      type: String,
      enum: ["LGU", "Private"],
      required: true,
    },
    address: { type: String, trim: true },
    trucks: [truckSchema],
    status: {
      type: String,
      enum: ["pending", "acknowledged", "rejected"],
      default: "pending",
    },
    submittedBy: { type: String, trim: true },
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
      const facility = await SlfFacility.findOne({ slfGenerator: this.slfGenerator }).select("province");
      if (facility) province = facility.province;
    }
    const provCode = getProvinceCode(province);

    const typeCode =
      this.companyType === "Private"
        ? "COM"
        : this.companyType === "LGU"
        ? "LGU"
        : "OTH";

    // Count existing docs with same province code and type to get next sequence
    const pattern = new RegExp(`^SLF-${provCode}-${typeCode}-`);
    const lastDoc = await DataSLF.findOne({ idNo: pattern }).sort({ idNo: -1 });
    let seq = 1;
    if (lastDoc && lastDoc.idNo) {
      const parts = lastDoc.idNo.split("-");
      const lastNum = parseInt(parts[3], 10);
      if (!isNaN(lastNum)) seq = lastNum + 1;
    }
    this.idNo = `SLF-${provCode}-${typeCode}-${String(seq).padStart(4, "0")}`;
  }
});

module.exports = mongoose.model("DataSLF", dataSLFSchema, "data-slf");
