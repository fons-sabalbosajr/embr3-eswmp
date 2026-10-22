const mongoose = require("mongoose");
const { dateFieldYearVisibilityPlugin } = require("../utils/yearVisibility");
const { createSlfVisibilityPlugin } = require("../utils/slfVisibility");
const { isHazardousWasteType } = require("../utils/wasteCategories");

const clientSchema = new mongoose.Schema(
  {
    clientName: { type: String, trim: true },
    clientType: { type: String, enum: ["Private", "LGU"], default: "Private" },
    // Free-text client address. The structured region/province/municipality fields
    // below are PSGC-coded and cannot hold the "Client Address" column the portal's
    // hauler bulk upload accepts (and the hauler export reads back), so an uploaded
    // address had nowhere to land and was dropped on save. Optional and additive —
    // existing records are unaffected.
    clientAddress: { type: String, trim: true },
    region: { type: String, trim: true },
    regionName: { type: String, trim: true },
    province: { type: String, trim: true },
    provinceName: { type: String, trim: true },
    municipality: { type: String, trim: true },
    municipalityName: { type: String, trim: true },
  },
  { _id: false }
);

const vehicleSchema = new mongoose.Schema(
  {
    plateNumber: { type: String, trim: true },
    vehicleType: { type: String, trim: true },
    capacity: { type: Number },
    capacityUnit: { type: String, enum: ["tons", "m³", "m3"], default: "m³" },
    selectedClients: [clientSchema],
    // Per-vehicle waste placement (volume goes to a specific open cell)
    actualVolume: { type: Number },
    actualVolumeUnit: { type: String, enum: ["tons", "m³", "m3"], default: "m³" },
    wasteType: { type: String, trim: true },
    hazWasteCode: [{ type: String, trim: true }],
    cellIndex: { type: Number },
    cellName: { type: String, trim: true },
    cellType: { type: String, trim: true },
  },
  { _id: false }
);

const truckSchema = new mongoose.Schema(
  {
    disposalTicketNo: { type: String, trim: true },
    hauler: { type: String, trim: true },
    plateNumber: { type: String, trim: true },
    truckCapacity: { type: Number },
    truckCapacityUnit: { type: String, enum: ["tons", "m³", "m3"], default: "m³" },
    vehicles: [vehicleSchema],
    actualVolume: { type: Number },
    actualVolumeUnit: { type: String, enum: ["tons", "m³", "m3"], default: "tons" },
    wasteType: { type: String, enum: ["Residual", "Hazardous Waste", "Treated Hazardous Waste"] },
    cellIndex: { type: Number },
    cellName: { type: String, trim: true },
    cellType: { type: String, trim: true },
    hazWasteCode: [{ type: String, trim: true }],
    lguCompanyName: { type: String, trim: true },
    companyType: { type: String, trim: true },
    address: { type: String, trim: true },
    selectedClients: [clientSchema],
  },
  { _id: false }
);

const haulerSchema = new mongoose.Schema(
  {
    haulerName: { type: String, trim: true },
    numberOfTrucks: { type: Number },
    officeAddress: { type: String, trim: true },
    // Legacy single-vehicle fields (kept for backward compatibility)
    plateNumber: { type: String, trim: true },
    vehicleType: { type: String, trim: true },
    capacity: { type: Number },
    capacityUnit: { type: String, enum: ["tons", "m³", "m3"], default: "m³" },
    // Multi-vehicle entries
    vehicles: [vehicleSchema],
    privateSectorClients: [{ type: mongoose.Schema.Types.Mixed }],
    clients: [clientSchema],
  },
  { _id: false }
);

// One admin correction of a waste placement's cell.
//
// A portal user can place a truck's volume in the wrong cell and only notice
// after the submission has been acknowledged. The admin fix must not overwrite
// the original assignment silently: `trucks[].cellIndex` becomes the corrected
// cell (so every reader — admin, portal, occupancy, reports — sees ONE current
// placement and the volume is never counted twice), and the placement it
// replaced is preserved here with who changed it, when, and why.
//
// Append-only: a slot corrected twice keeps both hops in order.
const cellCorrectionSchema = new mongoose.Schema(
  {
    // Which placement was moved. vehicleIndex is null for a truck-level slot.
    truckIndex: { type: Number, required: true },
    vehicleIndex: { type: Number, default: null },
    fromCellIndex: { type: Number, default: null },
    fromCellName: { type: String, trim: true },
    fromCellType: { type: String, trim: true },
    toCellIndex: { type: Number, required: true },
    toCellName: { type: String, trim: true },
    toCellType: { type: String, trim: true },
    // The volume that moved, recorded as it stood at correction time so the
    // audit entry stays readable even if the placement is corrected again.
    volume: { type: Number },
    volumeUnit: { type: String, trim: true },
    reason: { type: String, trim: true, required: true },
    correctedBy: { type: String, trim: true, required: true },
    correctedAt: { type: Date, default: Date.now },
    // WHICH workflow moved it. An admin correction and a portal reorganization
    // are both movements of one existing volume — they belong in the same
    // append-only log so the cell tracker can show "previous cell → current
    // cell" from persisted data — but they are not the same act, and the admin
    // views label them differently.
    source: {
      type: String,
      enum: ["admin_correction", "admin_assignment", "portal_organize", "portal_bulk"],
      default: "admin_correction",
    },
    // The submission's status when the correction was applied. A correction does
    // not change the workflow status — an acknowledged submission stays
    // acknowledged — so this records the state it was corrected in.
    statusAtCorrection: { type: String, trim: true },
  },
  { _id: true },
);

const dataSLFSchema = new mongoose.Schema(
  {
    slfGenerator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SlfFacility",
    },
    slfName: { type: String, trim: true },
    submissionId: { type: String, trim: true },
    // Client-supplied idempotency key for a submit request — lets a retried /
    // double-clicked / connection-lost submission return the already-saved records
    // instead of creating duplicates. Shared across all docs from one request.
    idempotencyKey: { type: String, trim: true, default: undefined },
    idNo: { type: String, trim: true },
    // Marks submissions made by dummy/test portal accounts (or against dummy
    // facilities) so they can be excluded from production admin views/reports.
    isDummy: { type: Boolean, default: false, index: true },
    dummyPortalUserId: { type: mongoose.Schema.Types.ObjectId, ref: "UserPortal" },
    previousIdNos: [{ type: String, trim: true }],
    // Portal user removed this submission from their own history view. The record
    // is still fully retained/visible on the admin side — this only hides it from
    // the submitting portal user's Submission History.
    hiddenFromPortal: { type: Boolean, default: false },

    // Cell Operations
    currentCellVolume: { type: Number },
    currentCellVolumeUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    cellStatus: { type: String, enum: ["Active", "Closed"], default: "Active" },

    // Baseline Information
    baselineUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    totalVolumeAccepted: { type: Number },
    totalVolumeAcceptedUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    activeCellResidualVolume: { type: Number },
    activeCellResidualUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    activeCellInertVolume: { type: Number },
    activeCellInertUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    activeCellHazardousVolume: { type: Number },
    activeCellHazardousUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    closedCellResidualVolume: { type: Number },
    closedCellResidualUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    closedCellInertVolume: { type: Number },
    closedCellInertUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    closedCellHazardousVolume: { type: Number },
    closedCellHazardousUnit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    acceptsHazardousWaste: { type: Boolean, default: false },
    activeCellEntries: [{
      cellName: { type: String, trim: true },
      cellType: { type: String, trim: true },
      cellIndex: { type: Number },
      wasteType: { type: String, trim: true },
      volume: { type: Number },
      unit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    }],
    closedCellEntries: [{
      cellName: { type: String, trim: true },
      cellType: { type: String, trim: true },
      cellIndex: { type: Number },
      wasteType: { type: String, trim: true },
      volume: { type: Number },
      unit: { type: String, enum: ["m³", "tons", "m3"], default: "m³" },
    }],
    accreditedHaulers: [haulerSchema],
    // Baseline update approval
    baselineUpdateRequested: { type: Boolean, default: false },
    baselineUpdateRequestedAt: { type: Date },
    baselineUpdateRequestReason: { type: String, trim: true },
    baselineUpdateApproved: { type: Boolean, default: false },
    baselineUpdateApprovedAt: { type: Date },
    baselineUpdateApprovedBy: { type: String, trim: true },

    dateOfDisposal: { type: Date, required: true },
    lguCompanyName: { type: String, required: true, trim: true },
    companyType: {
      type: String,
      enum: ["LGU", "Private"],
      required: true,
    },
    address: { type: String, trim: true },

    // Company Information (Basic Info tab)
    companyRegion: { type: String, trim: true },
    companyProvince: { type: String, trim: true },
    companyMunicipality: { type: String, trim: true },
    companyBarangay: { type: String, trim: true },

    trucks: [truckSchema],

    // Admin waste-placement corrections, oldest first. See cellCorrectionSchema.
    cellCorrections: [cellCorrectionSchema],

    // Admin review remark written by VERA on request (Submissions tab → Remarks).
    // Unlike the derived `remarks` flags this is stored: it costs a model call, and
    // it is a reviewer's note the admin chose to generate. Regenerating replaces it.
    veraRemark: {
      text: { type: String, trim: true },
      source: { type: String, enum: ["model", "fallback"] },
      model: { type: String, trim: true },
      generatedBy: { type: String, trim: true },
      generatedAt: { type: Date },
      // Fingerprint of the issues VERA reviewed (routes/dataSLF.js →
      // veraRemarkSignature). A list read whose issues no longer match it
      // queues an automatic re-review.
      signature: { type: String, trim: true },
      // true when VERA reviewed the submission on its own, false when an admin
      // asked for it.
      auto: { type: Boolean },
    },

    // Denormalized metric fields — computed from trucks/dateOfDisposal on save.
    // Aggregations may fall back to computing from trucks when these are missing
    // on older records. See computeSlfMetrics() + scripts/backfillDataSLFMetrics.js
    truckCount: { type: Number, default: 0 },
    totalVolumeM3: { type: Number, default: 0 },
    totalVolumeTons: { type: Number, default: 0 },
    residualVolumeM3: { type: Number, default: 0 },
    residualVolumeTons: { type: Number, default: 0 },
    hazardousVolumeM3: { type: Number, default: 0 },
    hazardousVolumeTons: { type: Number, default: 0 },
    submissionYear: { type: Number },
    submissionMonth: { type: Number },
    submissionDateKey: { type: String, trim: true },

    status: {
      type: String,
      enum: ["pending", "acknowledged", "rejected", "revert_requested", "reverted"],
      default: "pending",
    },
    revertRequested: { type: Boolean, default: false },
    revertReason: { type: String, trim: true },
    revertRequestedAt: { type: Date },
    revertedBy: { type: String, trim: true },
    revertedAt: { type: Date },
    revertFollowUpSubject: { type: String, trim: true },
    revertFollowUpMessage: { type: String, trim: true },
    revertFollowUpSentAt: { type: Date },
    // Resubmission trail. A resubmission keeps its ID No. (PUT /data-slf/:id), so
    // `previousIdNos` no longer marks one — these do. Written when a REVERTED
    // record is corrected and sent back; `resubmittedRevertReason` keeps the
    // reason it answered, because the resubmit clears `revertReason`.
    resubmittedAt: { type: Date },
    resubmitCount: { type: Number, default: 0 },
    resubmitComment: { type: String, trim: true },
    resubmittedRevertReason: { type: String, trim: true },
    temporaryDeleteAfter: { type: Date },
    submittedBy: { type: String, trim: true },
    // Soft delete
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, trim: true, default: null },
    // This record was soft-deleted BY THE CASCADE when its SLF facility was
    // deleted, not by an admin deleting the record itself.
    //
    // Restoring the facility must put back exactly what the cascade took and
    // nothing else: a submission an admin had already deleted on its own stays
    // deleted. Without this marker, restore would have to clear deletedAt for
    // every record of the facility and would resurrect those too.
    deletedWithFacility: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// m³ ↔ tons conversion factor — imported from the single source of truth
// (server/utils/volumeUnits.js) so the model, route, and cell-availability check
// can never drift out of sync. Also re-exposed as DataSLF.TON_PER_M3 below.
const { TON_PER_M3 } = require("../utils/volumeUnits");
const normalizeVolumeUnit = (unit) => String(unit || "m³").replace("m3", "m³").trim().toLowerCase();

// Compute denormalized metric fields from a trucks array + disposal date.
// Hazardous = wasteType contains "hazard"; everything else counts as residual.
// Missing volume → 0; missing unit → m³; invalid date → year/month/key left null.
function computeSlfMetrics(doc = {}) {
  const trucks = Array.isArray(doc.trucks) ? doc.trucks : [];
  const metrics = {
    truckCount: trucks.length,
    totalVolumeM3: 0,
    totalVolumeTons: 0,
    residualVolumeM3: 0,
    residualVolumeTons: 0,
    hazardousVolumeM3: 0,
    hazardousVolumeTons: 0,
  };
  // Waste type + volume live on each VEHICLE when a truck carries them (the portal
  // form stores per-vehicle wasteType/actualVolume), and only fall back to the
  // truck level for single-entry rows. Reading only the truck level made every
  // multi-vehicle truck — and any truck whose hazardous classification lives on
  // its vehicles — count as 0 hazardous. Mirror summarizeCellAssignment: prefer
  // the vehicles array, fall back to the truck.
  //
  // Every metric is stored in BOTH m³ AND tons, kept in lockstep via TON_PER_M3.
  // A facility that reports in tons used to leave the m³ fields at 0 (and vice
  // versa); the admin summary/breakdown/charts then displayed a single unit and
  // silently dropped every facility reporting in the other unit — which is why a
  // tons-based Hazardous Waste load (e.g. Floridablanca) summed to 0 m³. Populating
  // both units makes the "lockstep" assumption the display already relies on true,
  // so totals reconcile regardless of which unit a facility declared.
  const tally = (wasteType, volume, unitRaw) => {
    const amount = Number(volume || 0);
    if (!amount || Number.isNaN(amount)) return;
    const unit = normalizeVolumeUnit(unitRaw || doc.baselineUnit || "m³");
    const isTons = unit === "tons";
    // Canonical classification shared with the portal + admin (handles legacy
    // variants like "Hazardous", "HW", "hazardous_waste", "Treated Hazardous Waste").
    const isHazardous = isHazardousWasteType(wasteType);
    const m3 = isTons ? amount / TON_PER_M3 : amount;
    const tons = isTons ? amount : amount * TON_PER_M3;
    metrics.totalVolumeM3 += m3;
    metrics.totalVolumeTons += tons;
    if (isHazardous) {
      metrics.hazardousVolumeM3 += m3;
      metrics.hazardousVolumeTons += tons;
    } else {
      metrics.residualVolumeM3 += m3;
      metrics.residualVolumeTons += tons;
    }
  };
  for (const truck of trucks) {
    const vehicles = (Array.isArray(truck?.vehicles) ? truck.vehicles : []).filter(
      (v) => Number(v?.actualVolume || 0) > 0,
    );
    if (vehicles.length) {
      for (const v of vehicles) {
        tally(
          v?.wasteType ?? truck?.wasteType,
          v?.actualVolume,
          v?.actualVolumeUnit || truck?.actualVolumeUnit,
        );
      }
    } else {
      tally(truck?.wasteType, truck?.actualVolume, truck?.actualVolumeUnit);
    }
  }
  const disposal = doc.dateOfDisposal ? new Date(doc.dateOfDisposal) : null;
  if (disposal && !Number.isNaN(disposal.getTime())) {
    metrics.submissionYear = disposal.getUTCFullYear();
    metrics.submissionMonth = disposal.getUTCMonth() + 1;
    metrics.submissionDateKey = disposal.toISOString().slice(0, 10);
  }
  return metrics;
}

// Province name → abbreviation mapping for ID generation
const PROVINCE_CODES = {
  aurora: "AU",
  bataan: "BA",
  bulacan: "BU",
  "nueva ecija": "NE",
  nueva_ecija: "NE",
  pampanga: "PA",
  tarlac: "TA",
  zambales: "ZA",
};

// PSGC province code → abbreviation (Region III)
const PSGC_PROVINCE_CODES = {
  "030800000": "BA", // Bataan
  "031400000": "BU", // Bulacan
  "034900000": "NE", // Nueva Ecija
  "035400000": "PA", // Pampanga
  "036900000": "TA", // Tarlac
  "037100000": "ZA", // Zambales
  "037700000": "AU", // Aurora
};

function getProvinceCode(province) {
  if (!province) return "XX";
  const raw = String(province).trim();
  if (PSGC_PROVINCE_CODES[raw]) return PSGC_PROVINCE_CODES[raw];
  const key = raw.toLowerCase().replace(/^province of\s+/i, "").replace(/[_-]+/g, " ").trim();
  return PROVINCE_CODES[key] || raw.substring(0, 2).toUpperCase();
}

// Map companyType → ID No. TYPE segment. The TYPE segment must always reflect
// the entry's companyType so LGU and Private (PVT) submissions never get confused.
function typeCodeForCompanyType(companyType) {
  const value = String(companyType || "").trim().toLowerCase();
  if (value === "private" || value === "pvt") return "PVT";
  if (value === "lgu") return "LGU";
  return "OTH";
}

// Compute the next available sequence number for a given SLF-TYPE-PROV- prefix.
async function nextIdNoSequence(typeCode, provCode) {
  const DataSLF = mongoose.model("DataSLF");
  const pattern = new RegExp(`^SLF-${typeCode}-${provCode}-`);
  const lastDoc = await DataSLF.findOne({ idNo: pattern })
    .setOptions({ includeHiddenYears: true })
    .sort({ idNo: -1 });
  let seq = 1;
  if (lastDoc && lastDoc.idNo) {
    const parts = lastDoc.idNo.split("-");
    const lastNum = parseInt(parts[3], 10);
    if (!isNaN(lastNum)) seq = lastNum + 1;
  }
  return seq;
}

// An ID No. identifies a SUBMISSION. A record with no transport entries is not
// one — it is the baseline-only container that PATCH /portal-save-baseline writes
// an SLF's baseline into, and `submitEntries` rejects an empty trucks[] outright
// ("At least one truck entry is required"), so the two can never be confused.
//
// Stamping a baseline container with an ID No. is what made every first baseline
// save look like a pending submission (SLF-PVT-XX-0001 · 0 · No Waste Data ·
// Pending) in the portal and admin submission views. Baselines belong in the
// Baseline Data tab, which does not read idNo at all.
//
// The ID is still assigned the moment a record actually carries transport
// entries — including an existing container that later gains them — so a real
// submission is never left without one.
const isSubmissionRecord = (doc) =>
  Array.isArray(doc?.trucks) && doc.trucks.length > 0;

// Auto-generate the ID No based on province of the SLF
dataSLFSchema.pre("save", async function () {
  // Regenerate the TYPE segment when companyType changes on an existing entry,
  // so an LGU→Private (or vice-versa) edit never leaves a mismatched ID No.
  if (!this.isNew && this.idNo && this.isModified("companyType")) {
    const parts = String(this.idNo).split("-");
    if (parts.length >= 4 && parts[0] === "SLF") {
      const currentType = parts[1];
      const desiredType = typeCodeForCompanyType(this.companyType);
      if (desiredType !== "OTH" && desiredType !== currentType) {
        const provCode = parts[2] || "XX";
        const seq = await nextIdNoSequence(desiredType, provCode);
        const newIdNo = `SLF-${desiredType}-${provCode}-${String(seq).padStart(4, "0")}`;
        if (newIdNo !== this.idNo) {
          if (!Array.isArray(this.previousIdNos)) this.previousIdNos = [];
          this.previousIdNos.push(this.idNo);
          this.idNo = newIdNo;
        }
      }
    }
  }

  if (!this.idNo && isSubmissionRecord(this)) {
    const DataSLF = mongoose.model("DataSLF");
    const SlfFacility = mongoose.model("SlfFacility");

    // Resolve province from linked SLF facility
    let province = "";
    if (this.slfGenerator) {
      const facility = await SlfFacility.findById(this.slfGenerator).select("province");
      if (facility) province = facility.province || "";
    }
    if (!province && this.slfName) {
      const rawName = String(this.slfName).replace(/\s*\(.*?\)\s*/g, " ").trim();
      const nameRx = new RegExp(`^${rawName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
      const facility = await SlfFacility.findOne({
        deletedAt: null,
        $or: [{ lgu: nameRx }, { province: nameRx }],
      }).sort({ dataYear: -1 }).select("province");
      if (facility) province = facility.province || "";
    }
    let provCode = getProvinceCode(province);

    // Fallback 1: use PSGC province code stored on the submission itself
    if (provCode === "XX" && this.companyProvince) {
      provCode = getProvinceCode(this.companyProvince);
    }

    // Fallback 2: inherit province code from a previous submission for this SLF
    // (handles cases where SlfFacility.province is empty / not set)
    if (provCode === "XX") {
      const filter = this.slfGenerator
        ? { slfGenerator: this.slfGenerator }
        : this.slfName
        ? { slfName: this.slfName }
        : null;
      if (filter) {
        const prevDoc = await DataSLF.findOne({
          ...filter,
          idNo: { $exists: true, $ne: null },
        }).sort({ createdAt: -1 });
        if (prevDoc?.idNo) {
          const parts = prevDoc.idNo.split("-");
          if (parts.length >= 4 && parts[2] !== "XX") {
            provCode = parts[2];
          }
        }
      }
    }

    const typeCode =
      this.companyType === "Private"
        ? "PVT"
        : this.companyType === "LGU"
        ? "LGU"
        : "OTH";

    // Count existing docs with same province code and type to get next sequence
    const seq = await nextIdNoSequence(typeCode, provCode);
    this.idNo = `SLF-${typeCode}-${provCode}-${String(seq).padStart(4, "0")}`;
  }
});

dataSLFSchema.index({ deletedAt: 1, createdAt: -1 });
// The submissions list sorts strictly newest-first with an `_id` tiebreak (see
// routes/dataSLF.js). Without `_id` in the index the tiebreak forced an
// in-memory SORT and a full collection scan — 755 documents examined to return
// a 25-row page. With it the sort is served entirely from the index.
dataSLFSchema.index({ deletedAt: 1, createdAt: -1, _id: -1 });
dataSLFSchema.index({ deletedAt: 1, status: 1, createdAt: -1 });
dataSLFSchema.index({ deletedAt: 1, idNo: 1 });
// Standalone idNo index. The compound index above is keyed on `deletedAt` first,
// so it cannot serve a bare `idNo` filter — and the ID-repair tooling
// (repair-xx-ids / repair-type-ids), the `$in` collision check, and
// nextIdNoSequence() all query idNo WITHOUT a deletedAt predicate. Those are
// anchored `^SLF-…` prefix regexes and `$in` lookups, both of which this index
// turns from a full collection scan into a bounded index scan.
dataSLFSchema.index({ idNo: 1 });
dataSLFSchema.index({ deletedAt: 1, submissionId: 1 });
dataSLFSchema.index({ deletedAt: 1, lguCompanyName: 1 });
dataSLFSchema.index({ submissionId: 1 });
// Idempotency-key lookup on submit retries (sparse — only set on keyed requests).
dataSLFSchema.index({ idempotencyKey: 1 }, { sparse: true });
dataSLFSchema.index({ submittedBy: 1, createdAt: -1 });

// Indexes for summary aggregations + grouped/paginated list queries
dataSLFSchema.index({ deletedAt: 1, slfGenerator: 1, createdAt: -1 });
dataSLFSchema.index({ deletedAt: 1, slfName: 1, createdAt: -1 });

// The SAME two lookups, without a `deletedAt` bound.
//
// `deletedAt` is the PREFIX of both indexes above, so a query that does not
// constrain it cannot use either — and the submit path has two that don't: the
// authoritative accredited-hauler roster and the declared truck capacities are
// both read as `{ slfGenerator, "accreditedHaulers.0": { $exists: true } }`.
// With no usable index those became a COLLSCAN of the whole collection,
// fetching every submission document — each carrying its full `trucks` and
// `accreditedHaulers` arrays — and then sorting them in memory, once per entry
// being submitted. That is what exhausted the driver's socket timeout and
// reached the operator as "connection <n> to <atlas host>:27017 timed out".
//
// Adding the un-prefixed pair costs two indexes and changes no behaviour: the
// same documents match, they are simply found instead of scanned for, and the
// `createdAt` sort is served by the index rather than in memory.
dataSLFSchema.index({ slfGenerator: 1, createdAt: -1 });
dataSLFSchema.index({ slfName: 1, createdAt: -1 });
dataSLFSchema.index({ deletedAt: 1, dateOfDisposal: -1 });
dataSLFSchema.index({ deletedAt: 1, companyType: 1, status: 1 });
dataSLFSchema.index({ deletedAt: 1, submittedBy: 1, status: 1, createdAt: -1 });
dataSLFSchema.index({ deletedAt: 1, submissionYear: 1, submissionMonth: 1 });
// Cross-submission ticket reuse check (routes/dataSLF.js findTicketReuse): every
// ticket on a Submissions page is looked up within its facility in one query.
// Multikey on the trucks array; without it that lookup scans the facility.
dataSLFSchema.index({ slfGenerator: 1, "trucks.disposalTicketNo": 1 });

// Keep denormalized metrics in sync whenever trucks/dateOfDisposal change.
dataSLFSchema.pre("save", function () {
  if (this.isNew || this.isModified("trucks") || this.isModified("dateOfDisposal") || this.isModified("baselineUnit")) {
    const metrics = computeSlfMetrics(this);
    Object.assign(this, metrics);
  }
});

dataSLFSchema.plugin(dateFieldYearVisibilityPlugin("dateOfDisposal"));
// A non-operational facility's DATA is hidden across Portal Submissions when the
// setting is on. Applied on the model, not per endpoint: the module spans seven
// tabs and a dozen queries, and a hiding rule that is forgotten on one of them
// fails silently — the symptom is data appearing, which looks normal.
// See utils/slfVisibility; defaults to hiding nothing.
dataSLFSchema.plugin(createSlfVisibilityPlugin({ field: "slfGenerator" }));

const DataSLFModel = mongoose.model("DataSLF", dataSLFSchema, "data-slf");
DataSLFModel.PSGC_PROVINCE_CODES = PSGC_PROVINCE_CODES;
DataSLFModel.computeSlfMetrics = computeSlfMetrics;
// Exposed so volume analysis compares tons against m³ using the SAME conversion
// the metrics pipeline already uses, instead of re-deriving the ratio.
DataSLFModel.TON_PER_M3 = TON_PER_M3;
DataSLFModel.normalizeVolumeUnit = normalizeVolumeUnit;
module.exports = DataSLFModel;
