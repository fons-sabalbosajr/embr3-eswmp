const mongoose = require("mongoose");

const truckSchema = new mongoose.Schema(
  {
    disposalTicketNo: { type: String, trim: true },
    hauler: { type: String, trim: true },
    plateNumber: { type: String, trim: true },
    truckCapacity: { type: Number },
    truckCapacityUnit: { type: String, enum: ["tons", "m3"], default: "m3" },
    actualVolume: { type: Number },
    actualVolumeUnit: { type: String, enum: ["tons", "m3"], default: "tons" },
    wasteType: { type: String, enum: ["Residual", "Hazardous Waste"] },
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

// Auto-generate the ID No based on the formula
dataSLFSchema.pre("save", async function () {
  if (this.isNew && !this.idNo) {
    const DataSLF = mongoose.model("DataSLF");
    const count = await DataSLF.countDocuments();
    const nameParts = this.lguCompanyName.split(",");
    const afterComma = nameParts.length > 1 ? nameParts[1].trim() : this.lguCompanyName;
    const initials = afterComma.substring(0, 2).toUpperCase();
    const typeCode =
      this.companyType === "Private"
        ? "COM"
        : this.companyType === "LGU"
        ? "LGU"
        : "OTH";
    const seq = String(count + 1).padStart(4, "0");
    this.idNo = `SLF-${initials}-${typeCode}-${seq}`;
  }
});

module.exports = mongoose.model("DataSLF", dataSLFSchema, "data-slf");
