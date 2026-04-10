const mongoose = require("mongoose");

const tenYearSWMPlanSchema = new mongoose.Schema(
  {
    // Data Year (which monitoring year this record belongs to)
    dataYear: { type: Number, default: () => new Date().getFullYear(), index: true },

    // Location
    province: { type: String, trim: true },
    municipality: { type: String, trim: true },
    manilaBayArea: { type: String, trim: true },
    congressionalDistrict: { type: String, trim: true },
    longitude: { type: Number },
    latitude: { type: Number },

    // Plan Details
    typeOfSWMPlan: { type: String, trim: true },
    resolutionNo: { type: String, trim: true },
    periodCovered: { type: String, trim: true },
    yearApproved: { type: Number },
    endPeriod: { type: Number },
    forRenewal: { type: String, trim: true },

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

    // Tracking
    trackingOfReports: { type: String, trim: true },

    // Environmental Data
    pcg: { type: Number },
    totalWasteGeneration: { type: Number },
    wasteDiversionRate: { type: Number },
    lguFinalDisposal: { type: String, trim: true },
    remarksAndRecommendation: { type: String, trim: true },

    // Compliance (a-f)
    sourceReduction: { type: String, trim: true },
    segregatedCollection: { type: String, trim: true },
    storageAndSetout: { type: String, trim: true },
    processingMRF: { type: String, trim: true },
    transferStation: { type: String, trim: true },
    disposalFacilities: { type: String, trim: true },

    // Advise / Compliance
    adviseLetterDateIssued: { type: String, trim: true },
    complianceToAdvise: { type: String, trim: true },
    remarks: { type: String, trim: true },

    // Waste Composition
    biodegradableWaste: { type: Number },
    biodegradablePercent: { type: Number },
    recyclableWaste: { type: Number },
    recyclablePercent: { type: Number },
    residualWithPotential: { type: Number },
    residualWithPotentialPercent: { type: Number },
    residualWasteForDisposal: { type: Number },
    residualPercent: { type: Number },
    specialWaste: { type: Number },
    specialPercent: { type: Number },

    // Rates
    wasteDiversionRateCalc: { type: Number },
    disposalRate: { type: Number },

    // Document
    signedDocument: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TenYearSWMPlan", tenYearSWMPlanSchema, "10_year_swm");
