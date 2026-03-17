/**
 * Seed script: Import 10-YEAR SWM PLAN data (2026) from Excel into MongoDB
 *
 * Usage:  node seeds/seed10YearSwm.js
 */
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");
require("dotenv").config();

const TenYearSWMPlan = require("../models/TenYearSWMPlan");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const EXCEL_PATH = path.resolve(__dirname, "../../front-end/docs/eswm_universe.xlsx");
const SHEET_NAME = "10-YEAR SWM PLAN";

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === "number") {
    // Excel serial date
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + val * 86400000);
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function num(val) {
  if (val == null || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function str(val) {
  if (val == null) return null;
  return String(val).trim() || null;
}

async function seed() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("Connected.");

  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) {
    console.error(`Sheet "${SHEET_NAME}" not found. Available sheets:`, wb.SheetNames);
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  console.log(`Read ${rows.length} rows from "${SHEET_NAME}"`);

  const records = rows
    .filter((r) => r["Province"] && r["Municipality"])
    .map((r) => ({
      dataYear: 2026,
      province: str(r["Province"]),
      municipality: str(r["Municipality"]),
      manilaBayArea: str(r["Manila Bay Area (MBA)"]),
      congressionalDistrict: str(r["Congressional District"]),
      longitude: num(r["Lat."]),
      latitude: num(r["Long."]),

      typeOfSWMPlan: str(r["Type of SWM Plan"]),
      resolutionNo: str(r["Resolution No. "] || r["Resolution No."]),
      periodCovered: str(r["Period Covered"]),
      yearApproved: num(r["Year Approved"]),
      endPeriod: num(r["End Period"]),
      forRenewal: str(r["For Renewal"]),

      enmoAssigned: str(r["ENMO Assigned"]),
      eswmStaff: str(r["ESWM Staff"]),
      focalPerson: str(r["Focal Person"]),

      targetMonth: str(r["Target Month"]),
      iisNumber: str(r["IIS NUMBER"]),
      dateOfMonitoring: parseDate(r["Date of Monitoring"]),
      dateReportPrepared: parseDate(r["Date Report Prepared (Submitted to IIS by ENMO)"]),
      dateReportReviewedStaff: parseDate(r["Date Report Reviewed (by ESWM Staff)"]),
      dateReportReviewedFocal: parseDate(r["Date Report Reviewed (by Focal Person)"]),
      dateReportApproved: parseDate(r["Date Report Approved"]),

      totalDaysReportPrepared: num(r["Total No. of Days (Report prepared)"]),
      totalDaysReviewedStaff: num(r["Total No. of Days (Report Reviewed by ESWM Staff)"]),
      totalDaysReviewedFocal: num(r["Total No. of Days (Report Reviewed by Focal)"]),
      totalDaysApproved: num(r["Total No. of Days (Report Approved by C, ESWM)"]),

      trackingOfReports: str(r["Tracking of Reports\n(To be filled out by Planning Section)"]),

      pcg: num(r["PCG"]),
      totalWasteGeneration: num(r["Total Waste Generation"]),
      wasteDiversionRate: num(r["Waste Diversion Rate (%)"]),
      lguFinalDisposal: str(r["LGU Final Disposal"]),
      remarksAndRecommendation: str(r["Remarks and Recommendation\n(Compliant/ Non-Compliant)"]),

      sourceReduction: str(r["a. source reduction activities at source are present"]),
      segregatedCollection: str(r["b. Collection segregated collection"]),
      storageAndSetout: str(r["c. Storage and setout (Segregation at source)"]),
      processingMRF: str(r["d. Processing MRF"]),
      transferStation: str(r["e. Transfer Station"]),
      disposalFacilities: str(r["f. Disposal Facilities"]),

      adviseLetterDateIssued: str(r["Advise Letter/Notice Date Issued"]),
      complianceToAdvise: str(r["Compliance to Advise/ Letter Issued"]),
      remarks: str(r["Remarks"]),

      biodegradableWaste: num(r["Biodegradable Wastes (kg/day)"]),
      biodegradablePercent: num(r["Bio (%)"]),
      recyclableWaste: num(r["Recyclable Wastes (kg/day)"]),
      recyclablePercent: num(r["Recyclable (%)"]),
      residualWithPotential: num(r["Residual with\npotential (kg/day)"]),
      residualWithPotentialPercent: num(r["Residual with Potential (%)"]),
      residualWasteForDisposal: num(r["Residual Wastes for Disposal (kg/day)"]),
      residualPercent: num(r["Residual (%)"]),
      specialWaste: num(r["Special Wastes\n(kg/day)"]),
      specialPercent: num(r["Special (%)"]),

      wasteDiversionRateCalc: num(r["Waste Diversion\nRate (%)"]),
      disposalRate: num(r["Disposal\nRate (%)"]),

      signedDocument: str(r["Signed Document"]),
    }));

  console.log(`Mapped ${records.length} valid records.`);

  // Clear existing 2026 data and insert fresh
  const deleted = await TenYearSWMPlan.deleteMany({ dataYear: { $in: [2026, null] } });
  console.log(`Cleared ${deleted.deletedCount} existing 2026 records.`);

  const inserted = await TenYearSWMPlan.insertMany(records);
  console.log(`Inserted ${inserted.length} records into 10_year_swm collection.`);

  await mongoose.disconnect();
  console.log("Done. MongoDB disconnected.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
