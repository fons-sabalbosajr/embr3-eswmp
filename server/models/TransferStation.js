const mongoose = require("mongoose");
const { dataYearVisibilityPlugin } = require("../utils/yearVisibility");

const transferStationSchema = new mongoose.Schema(
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
    typeOfOwnership: { type: String, trim: true },
    actualWasteReceived: { type: String, trim: true },
    distanceToSLF: { type: String, trim: true },

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
  { timestamps: true },
);

transferStationSchema.plugin(dataYearVisibilityPlugin);

module.exports = mongoose.model(
  "TransferStation",
  transferStationSchema,
  "transfer_stations",
);
