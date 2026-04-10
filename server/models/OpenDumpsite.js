const mongoose = require("mongoose");

const openDumpsiteSchema = new mongoose.Schema(
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

    // Operations
    yearStartedOperation: { type: Number },
    yearEndOperation: { type: Number },
    yearFullyRehabilitated: { type: String, trim: true },
    yearGranted: { type: Number },
    amountGranted: { type: Number },

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

    // Status
    statusOfSiteArea: { type: String, trim: true },

    // Rehabilitation Checklist
    siteClearing: { type: String, trim: true },
    siteGrading: { type: String, trim: true },
    soilCover: { type: String, trim: true },
    drainageControl: { type: String, trim: true },
    leachateManagement: { type: String, trim: true },
    gasManagement: { type: String, trim: true },
    fencingAndSecurity: { type: String, trim: true },
    signages: { type: String, trim: true },
    burningProhibition: { type: String, trim: true },

    // Compliance
    remarksAndRecommendation: { type: String, trim: true },
    docketNoNOV: { type: String, trim: true },
    dateOfIssuanceNOV: { type: String, trim: true },
    dateOfTechnicalConference: { type: String, trim: true },
    commitments: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("OpenDumpsite", openDumpsiteSchema, "open_dumpsites");
