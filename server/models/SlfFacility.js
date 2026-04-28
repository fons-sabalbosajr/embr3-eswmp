const mongoose = require("mongoose");
const { dataYearVisibilityPlugin } = require("../utils/yearVisibility");

const slfFacilitySchema = new mongoose.Schema(
  {
    dataYear: { type: Number, default: () => new Date().getFullYear(), index: true },

    // Location
    province: { type: String, trim: true },
    lgu: { type: String, trim: true },
    barangay: { type: String, trim: true },
    manilaBayArea: { type: String, trim: true },
    congressionalDistrict: { type: String, trim: true },
    ownership: { type: String, trim: true },
    latitude: { type: Number },
    longitude: { type: Number },

    // Facility Details
    yearStartedOperation: { type: Number },
    category: { type: String, trim: true },
    volumeCapacity: { type: Number },
    noOfLGUServed: { type: Number },

    // Permits
    eccNo: { type: String, trim: true },
    dischargePermit: { type: String, trim: true },
    permitToOperate: { type: String, trim: true },
    hazwasteGenerationId: { type: String, trim: true },

    // Personnel
    enmo: { type: String, trim: true },
    eswmStaff: { type: String, trim: true },
    focalPerson: { type: String, trim: true },

    // Monitoring
    targetMonth: { type: String, trim: true },
    iisNumber: { type: String, trim: true },
    dateOfMonitoring: { type: Date },
    dateReportPrepared: { type: Date },
    dateReportReviewedStaff: { type: Date },
    dateReportReviewedFocal: { type: Date },
    dateReportApproved: { type: Date },

    // Processing Days
    totalDaysReportPrepared: { type: Number },
    totalDaysReviewedStaff: { type: Number },
    totalDaysReviewedFocal: { type: Number },
    totalDaysApproved: { type: Number },

    // Tracking
    trackingOfReports: { type: String, trim: true },

    // Operations
    statusOfSLF: { type: String, trim: true },
    remainingLifeSpan: { type: String, trim: true },
    actualResidualWasteReceived: { type: Number },
    numberOfCell: { type: Number },
    cellCapacities: [{ type: Number }],
    cellStatuses: [{ type: String, enum: ["Operational", "Closed"], default: "Operational" }],
    cellTypes: [{ type: String, trim: true, default: "Residual" }], // per-cell: "Residual" or "Treated Haz Waste"
    estimatedVolumeWaste: { type: Number },
    noOfLeachatePond: { type: Number },
    numberOfGasVents: { type: Number },
    mrfEstablished: { type: String, trim: true },

    // Leachate Pond Details
    leachatePondDetails: [{
      pondNo: { type: Number },
      description: { type: String, trim: true },
      status: { type: String, trim: true, default: "Active" },
      attachments: [{ type: String, trim: true }],
    }],

    // Gas Vent Details
    gasVentDetails: [{
      ventNo: { type: Number },
      ventType: { type: String, trim: true },
      status: { type: String, trim: true, default: "Active" },
      description: { type: String, trim: true },
      attachments: [{ type: String, trim: true }],
    }],

    // Trash Slide Prevention Measures
    trashSlideMeasures: [{
      measure: { type: String, trim: true },
      description: { type: String, trim: true },
      status: { type: String, trim: true, default: "Implemented" },
      attachments: [{ type: String, trim: true }],
    }],

    // Fire Prevention Measures
    firePrevMeasures: [{
      measure: { type: String, trim: true },
      description: { type: String, trim: true },
      status: { type: String, trim: true, default: "Implemented" },
      attachments: [{ type: String, trim: true }],
    }],

    // Remarks & Compliance
    remarksAndRecommendation: { type: String, trim: true },
    remarksCompliance: { type: String, trim: true },
    findings: { type: String, trim: true },
    adviseLetterDateIssued: { type: String, trim: true },
    complianceToAdvise: { type: String, trim: true },
    docketNoNOV: { type: String, trim: true },
    dateOfIssuanceNOV: { type: String, trim: true },
    dateOfTechnicalConference: { type: String, trim: true },
    commitments: { type: String, trim: true },
    signedDocument: { type: String, trim: true },

    // Link to SLF Generator (portal)
    slfGenerator: { type: mongoose.Schema.Types.ObjectId, ref: "SLFGenerator" },

    // Soft delete
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

slfFacilitySchema.plugin(dataYearVisibilityPlugin);

module.exports = mongoose.model("SlfFacility", slfFacilitySchema, "slf_facilities");
