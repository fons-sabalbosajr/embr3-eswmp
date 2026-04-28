const mongoose = require("mongoose");
const { dataYearVisibilityPlugin } = require("../utils/yearVisibility");

const technicalAssistanceSchema = new mongoose.Schema(
  {
    dataYear: { type: Number, default: () => new Date().getFullYear(), index: true },

    // Location
    province: { type: String, trim: true },
    municipality: { type: String, trim: true },
    barangay: { type: String, trim: true },
    manilaBayArea: { type: String, trim: true },

    // Personnel
    enmoAssigned: { type: String, trim: true },
    eswmStaff: { type: String, trim: true },
    focalPerson: { type: String, trim: true },

    // Monitoring
    yearMonitored: { type: Number },
    dateConducted: { type: String, trim: true },
    targetMonth: { type: String, trim: true },
    iisNumber: { type: String, trim: true },
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

    // Details
    typeOfFacility: { type: String, trim: true },
    status: { type: String, trim: true },
    conductedTechCon: { type: String, trim: true },
    remarks: { type: String, trim: true },
  },
  { timestamps: true }
);

technicalAssistanceSchema.plugin(dataYearVisibilityPlugin);

module.exports = mongoose.model("TechnicalAssistance", technicalAssistanceSchema, "technical_assistance");
