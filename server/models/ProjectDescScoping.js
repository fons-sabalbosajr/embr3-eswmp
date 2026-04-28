const mongoose = require("mongoose");
const { dataYearVisibilityPlugin } = require("../utils/yearVisibility");

const projectDescScopingSchema = new mongoose.Schema(
  {
    dataYear: { type: Number, default: () => new Date().getFullYear(), index: true },

    // Location
    province: { type: String, trim: true },
    municipality: { type: String, trim: true },
    mailingAddress: { type: String, trim: true },
    locationOfFacility: { type: String, trim: true },
    dateOfInstallation: { type: String, trim: true },
    manilaBayArea: { type: String, trim: true },
    latitude: { type: Number },
    longitude: { type: Number },

    // Permits & Compliance Docs
    contractWithTSD: { type: String, trim: true },
    numberOfBinsInstalled: { type: Number },
    hazwasteGeneratorCert: { type: String, trim: true },
    ecc: { type: String, trim: true },
    wastewaterDischargePermit: { type: String, trim: true },
    permitToOperateAPSI: { type: String, trim: true },

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

    // Operations
    statusOfPDS: { type: String, trim: true },
    hwGeneration: { type: String, trim: true },

    // Compliance
    remarks: { type: String, trim: true },
    adviseLetterIssued: { type: String, trim: true },
    complianceToAdvise: { type: String, trim: true },
    signedDocument: { type: String, trim: true },
  },
  { timestamps: true }
);

projectDescScopingSchema.plugin(dataYearVisibilityPlugin);

module.exports = mongoose.model("ProjectDescScoping", projectDescScopingSchema, "project_desc_scoping");
