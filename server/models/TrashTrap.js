const mongoose = require("mongoose");
const { dataYearVisibilityPlugin } = require("../utils/yearVisibility");

const trashTrapSchema = new mongoose.Schema(
  {
    dataYear: { type: Number, default: () => new Date().getFullYear(), index: true },

    // Location
    province: { type: String, trim: true },
    municipality: { type: String, trim: true },
    barangay: { type: String, trim: true },
    manilaBayArea: { type: String, trim: true },
    latitude: { type: Number },
    longitude: { type: Number },

    // Installation
    dateInstalled: { type: Date },

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

    // Status & Operations
    statusOfTrashTraps: { type: String, trim: true },
    noOfTrashTrapsHDPE: { type: Number },
    statusOfWasteLifter: { type: String, trim: true },
    statusOfPlasticBoat: { type: String, trim: true },
    estimatedVolumeWasteHauled: { type: Number },
    dateOfLastHauling: { type: Date },

    // Remarks & Compliance
    remarks: { type: String, trim: true },
    adviseLetterDateIssued: { type: String, trim: true },
    complianceToAdvise: { type: String, trim: true },
    remarks2: { type: String, trim: true },
    signedReport: { type: String, trim: true },
  },
  { timestamps: true }
);

trashTrapSchema.plugin(dataYearVisibilityPlugin);

module.exports = mongoose.model("TrashTrap", trashTrapSchema, "trash_traps");
