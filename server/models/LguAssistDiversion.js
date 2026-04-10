const mongoose = require("mongoose");

const lguAssistDiversionSchema = new mongoose.Schema(
  {
    dataYear: { type: Number, default: () => new Date().getFullYear(), index: true },

    // Location
    province: { type: String, trim: true },
    lgu: { type: String, trim: true },

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

    // Waste Data
    totalWasteGeneration: { type: Number },
    totalWasteDiverted: { type: Number },
    percentageWasteDiversion: { type: Number },

    // Status
    statusAccomplishment: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LguAssistDiversion", lguAssistDiversionSchema, "lgu_assist_diversion");
