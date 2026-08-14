const mongoose = require("mongoose");
const { dataYearVisibilityPlugin } = require("../utils/yearVisibility");

const roundThreeDecimals = (value) => {
  if (value === null || value === undefined || value === "") return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 1000) / 1000 : value;
};

const isThreeDecimalNonNegative = (value) => {
  if (value === null || value === undefined || value === "") return true;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && Math.round(numeric * 1000) === numeric * 1000;
};

const threeDecimalNumber = {
  type: Number,
  set: roundThreeDecimals,
  validate: {
    validator: isThreeDecimalNonNegative,
    message: "{PATH} must be a non-negative number with no more than 3 decimal places.",
  },
};

const slfFacilitySchema = new mongoose.Schema(
  {
    dataYear: { type: Number, default: () => new Date().getFullYear(), index: true },

    // Marks demo/test SLF records created via Developer Settings > Dummy Data
    // Configuration so they can be filtered out of real reporting.
    isDummy: { type: Boolean, default: false, index: true },

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
    volumeCapacityUnit: { type: String, trim: true, default: 'tons' },
    receivingVolumeCapacity: { type: Number },
    receivingVolumeCapacityUnit: { type: String, trim: true, default: 'tons' },
    noOfLGUServed: { type: Number },
    lguServedList: [{ type: String, trim: true }],
    privateCompaniesServed: [{ type: String, trim: true }],

    // Permits
    eccNo: { type: String, trim: true },
    dischargePermit: { type: String, trim: true },
    dischargePermitValidity: { type: Date },
    dischargePermitStatus: { type: String, trim: true }, // "New" | "Renewal"
    dischargePermits: [{
      permitNo: { type: String, trim: true },
      permitType: { type: String, enum: ["Domestic", "Industrial", ""], default: "" },
      validity: { type: Date },
      status: { type: String, trim: true },
    }],
    permitToOperate: { type: String, trim: true },
    permitToOperateValidity: { type: Date },
    permitToOperateStatus: { type: String, trim: true }, // "New" | "Renewal"
    permitToOperatePermits: [{
      permitNo: { type: String, trim: true },
      validity: { type: Date },
      status: { type: String, trim: true },
    }],
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
    dateReportReviewedStaff: { type: String, trim: true },
    dateReportReviewedFocal: { type: String, trim: true },
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
    actualResidualWasteReceived: threeDecimalNumber,
    wasteReceivedUnit: { type: String, trim: true, default: 'tons' },
    estimatedVolumeWasteUnit: { type: String, trim: true, default: 'tons' },
    numberOfCell: { type: Number },
    // Optional per-cell custom display names. Index-aligned with the other cell
    // arrays. Empty/missing entry => fall back to the derived "Cell N" label.
    cellNames: [{ type: String, trim: true }],
    cellCapacities: [threeDecimalNumber],
    cellCapacityUnits: [{ type: String, enum: ["m³", "tons", "m3"], default: "tons" }],
    cellStatuses: [{ type: String, enum: ["Active Cell", "Used/Completed", "Under Construction", "Reserved Area", "Not Existed", "Operational", "Closed", "Reserved Cell"], default: "Active Cell" }],
    cellTypes: [{ type: String, trim: true, default: "Residual" }], // per-cell: "Residual" or "Treated Haz Waste"
    // per-cell: whether portal/SLF users may dispose volume-waste submissions into this cell.
    // Empty/undefined => fall back to active cell status. Explicit false => disallow.
    cellSubmissionAllowed: [{ type: Boolean }],
    cellNotes: [{ type: String, trim: true }], // per-cell notes (used for Under Construction / Reserved Cell status)
    cellFillValues: [threeDecimalNumber],
    cellFillUnits: [{ type: String, enum: ["m³", "tons", "m3"], default: "tons" }],
    // Parallel to cellFillValues: true where an admin TYPED that cell's Waste in
    // Cell figure (SLF Table → Edit → Waste in Cell).
    //
    // Waste in Cell is normally DERIVED — baseline + valid submissions,
    // recomputed by refreshFacilityCellOccupancy on every submission, placement
    // and acknowledgement. Without this flag a hand-entered figure was silently
    // discarded: the recompute overwrote it on the next write, and every view
    // that reads the derived rollup never showed it at all. The flag makes the
    // admin's declaration deliberate and durable, and clearing the field hands
    // the cell back to the derived value.
    cellFillOverridden: [{ type: Boolean }],
    // Which version of utils/cellOccupancy.js wrote the derived cell figures on
    // this facility. When the calculation changes its version is bumped and the
    // startup repair sweep recomputes every facility still carrying an older
    // stamp — without it, a corrected calculation would leave the previously
    // stored (wrong) numbers in place until something happened to touch the
    // facility. Derived; never entered by a user.
    cellOccupancyVersion: { type: Number, default: 0, index: true },
    // Provenance split of cellFillValues, in the SAME unit as cellFillUnits.
    // Derived — written only by utils/cellOccupancy.js via refreshFacilityCellOccupancy.
    // These exist so every view (admin dashboard gauges, portal cell utilization,
    // Baseline Breakdown, Submitted Volume tile) reads ONE set of numbers instead
    // of each recomputing its own and disagreeing.
    cellFillBaselineValues: [threeDecimalNumber],
    cellFillSubmittedValues: [threeDecimalNumber],
    baselineVolumeTotal: threeDecimalNumber,
    submittedVolumeTotal: threeDecimalNumber,
    estimatedVolumeWaste: threeDecimalNumber,
    noOfLeachatePond: { type: Number },
    numberOfGasVents: { type: Number },
    mrfEstablished: { type: String, trim: true }, // legacy — kept for backward compat
    hasMRF: { type: Boolean, default: false },
    mrfDetails: [{
      name: { type: String, trim: true },
      type: { type: String, trim: true },
      status: { type: String, trim: true, default: "Active" },
      notes: { type: String, trim: true },
    }],
    receivingFacilities: [{
      mrfTypes: [{ type: String, trim: true }],
      mrfName: { type: String, trim: true },
      status: { type: String, trim: true, default: "Active" },
      description: { type: String, trim: true },
    }],
    hasWastewaterTreatmentFacility: { type: Boolean, default: false },
    wastewaterTreatmentFacilityType: [{ type: String, trim: true }],
    wastewaterTreatmentFacilityRemarks: { type: String, trim: true },

    // Leachate Treatment Plant Details
    leachatePondDetails: [{
      pondNo: { type: Number },
      description: { type: String, trim: true },
      status: { type: String, trim: true, default: "Active" },
      hasWastewaterTreatmentFacility: { type: Boolean, default: false },
      wastewaterTreatmentFacilityType: [{ type: String, trim: true }],
      wastewaterTreatmentFacilityRemarks: { type: String, trim: true },
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
    technicalConferenceConducted: { type: Boolean, default: false },
    commitmentFiles: [{ type: String, trim: true }],
    progressReportFiles: [{ type: String, trim: true }],

    // Preventive Measures / Closure Plan
    preventiveMeasureFiles: [{ type: String, trim: true }],
    preventiveMeasureFileDetails: [{
      url: { type: String, trim: true },
      fileName: { type: String, trim: true },
      description: { type: String, trim: true },
      docType: { type: String, trim: true, default: "Preventive Measures" },
    }],
    scrpDetails: [{
      planTitle: { type: String, trim: true },
      status: { type: String, trim: true },
      remarks: { type: String, trim: true },
      attachments: [{ type: String, trim: true }],
    }],

    // Gallery & Documents
    galleryPhotos: [{ type: String, trim: true }], // array of photo URLs
    galleryItems: [{
      url: { type: String, trim: true },
      fileName: { type: String, trim: true }, // original uploaded filename (display)
      caption: { type: String, trim: true },
      folder: { type: String, trim: true },
      component: { type: String, trim: true },
    }],
    slfDocuments: [{
      title: { type: String, trim: true },
      url: { type: String, trim: true },
      fileName: { type: String, trim: true }, // original uploaded filename (display)
      description: { type: String, trim: true },
      docType: { type: String, trim: true },
    }],

    // VERA-generated Prevention-Measures document summaries (cache). Keyed by the
    // source document URL so a REPLACED document (which always gets a new URL)
    // invalidates automatically — a summary is only ever shown for a document that
    // currently belongs to THIS facility (no cross-SLF leakage). Regenerated on
    // demand from the admin Prevention view.
    preventionSummaries: [{
      fileUrl: { type: String, trim: true },     // source document (identity/invalidation key)
      fileName: { type: String, trim: true },
      docType: { type: String, trim: true },     // "Fire Prevention" | "Trash Slide Measures" | "Preventive Measures" | …
      summary: { type: String, trim: true },
      confidence: { type: String, trim: true },  // "high" | "low"
      warning: { type: String, trim: true },     // set when no reliable summary could be produced
      model: { type: String, trim: true },
      generatedAt: { type: Date },
      generatedBy: { type: String, trim: true },
    }],

    // Link to SLF Generator (portal)
    slfGenerator: { type: mongoose.Schema.Types.ObjectId, ref: "SLFGenerator" },

    // Soft delete
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

// Back the query shapes hit on every dashboard/table/modal load: the list filter
// (deletedAt [+dataYear]), the province/lgu sort + duplicate-site detection, the
// portal linkage join, and trash/restore. Without these, each read was a full
// collection scan.
slfFacilitySchema.index({ deletedAt: 1, dataYear: 1 });
slfFacilitySchema.index({ deletedAt: 1, province: 1, lgu: 1 });
slfFacilitySchema.index({ deletedAt: 1, isDummy: 1, dataYear: 1 });
slfFacilitySchema.index({ slfGenerator: 1 });
slfFacilitySchema.index({ deletedAt: 1 });

slfFacilitySchema.plugin(dataYearVisibilityPlugin);

module.exports = mongoose.model("SlfFacility", slfFacilitySchema, "slf_facilities");
