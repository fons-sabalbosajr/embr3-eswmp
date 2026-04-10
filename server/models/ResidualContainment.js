const mongoose = require("mongoose");

const residualContainmentSchema = new mongoose.Schema(
  {
    dataYear: { type: Number, default: () => new Date().getFullYear(), index: true },

    // Location
    province: { type: String, trim: true },
    municipality: { type: String, trim: true },
    barangay: { type: String, trim: true },
    manilaBayArea: { type: String, trim: true },
    congressionalDistrict: { type: String, trim: true },
    latitude: { type: Number },
    longitude: { type: Number },

    // Personnel
    enmoAssigned: { type: String, trim: true },
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
    trackingOfReports: { type: String, trim: true },

    // Facility Details
    statusOfFacility: { type: String, trim: true },
    facilityOrBin: { type: String, trim: true },
    numberOfBinUsed: { type: Number },
    totalFloorArea: { type: Number },
    dateOperationalized: { type: Number },
    actualWasteReceived: { type: String, trim: true },
    rcaStorageCapacity: { type: String, trim: true },
    totalVolumeResidualWaste: { type: Number },
    dateOfHauling: { type: Date },
    volumeOfWasteHauled: { type: String, trim: true },
    hauler: { type: String, trim: true },
    finalDisposal: { type: String, trim: true },
    coProcessingFacility: { type: String, trim: true },
    noOfBarangayServed: { type: Number },

    // Compliance
    remarksIfNotOperational: { type: String, trim: true },
    remarksAndRecommendation: { type: String, trim: true },
    findings: { type: String, trim: true },
    adviseLetterDateIssued: { type: String, trim: true },
    complianceToAdvise: { type: String, trim: true },
    docketNoNOV: { type: String, trim: true },
    violation: { type: String, trim: true },
    dateOfIssuanceNOV: { type: String, trim: true },
    dateOfTechnicalConference: { type: String, trim: true },
    commitments: { type: String, trim: true },
    signedReport: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ResidualContainment", residualContainmentSchema, "residual_containment");
