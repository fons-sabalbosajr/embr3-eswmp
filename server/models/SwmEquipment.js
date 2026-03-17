const mongoose = require("mongoose");

const swmEquipmentSchema = new mongoose.Schema(
  {
    // Location
    province: { type: String, trim: true },
    municipality: { type: String, trim: true },
    barangay: { type: String, trim: true },
    manilaBayArea: { type: String, trim: true },
    congressionalDistrict: { type: String, trim: true },
    latitude: { type: Number },
    longitude: { type: Number },

    // Equipment
    typeOfEquipment: { type: String, trim: true },

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

    // Equipment Status
    statusOfBioShredder: { type: String, trim: true },
    statusOfBioComposter: { type: String, trim: true },
    weightOfSoilEnhancer: { type: Number },
    statusOfCCTV: { type: String, trim: true },
    statusOfPlasticChairFactory: { type: String, trim: true },
    noPlasticChairProduced: { type: Number },

    // Remarks & Compliance
    remarksNonOperating: { type: String, trim: true },
    adviseLetterIssued: { type: String, trim: true },
    complianceToAdvise: { type: String, trim: true },
    signedDocument: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SwmEquipment", swmEquipmentSchema, "swm_equipment");
