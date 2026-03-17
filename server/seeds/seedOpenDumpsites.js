/**
 * Seed: Import Open Dumpsites (ODS) data from Excel
 * Usage: node seeds/seedOpenDumpsites.js
 */
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");
require("dotenv").config();

const OpenDumpsite = require("../models/OpenDumpsite");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const EXCEL_PATH = path.resolve(__dirname, "../../front-end/docs/eswm_universe.xlsx");
const SHEET_NAME = "ODS 3";

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + val * 86400000);
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}
function num(val) {
  if (val == null || val === "") return null;
  const n = Number(String(val).replace(/,\s*/g, "").trim());
  return isNaN(n) ? null : n;
}
function str(val) {
  if (val == null) return null;
  return String(val).trim() || null;
}

async function seed() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);

  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) { console.error(`Sheet "${SHEET_NAME}" not found.`); process.exit(1); }

  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  console.log(`Read ${rows.length} rows from "${SHEET_NAME}"`);

  const records = rows
    .filter((r) => r["Province"] && r["Municipality"])
    .map((r) => ({
      province: str(r["Province"]),
      municipality: str(r["Municipality"]),
      barangay: str(r["Barangay"]),
      manilaBayArea: str(r["Manila Bay Area (MBA)"]),
      congressionalDistrict: str(r["Congressional District"]),
      latitude: num(r["Lat."]),
      longitude: num(r["Long."]),
      yearStartedOperation: num(r["Year Started Operation"]),
      yearEndOperation: num(r["Year End Operation"]),
      yearFullyRehabilitated: str(r["Year Fully Rehabilitated"]),
      yearGranted: num(r["Year Granted"]),
      amountGranted: num(r["Amount Granted"]),
      enmoAssigned: str(r["ENMO"]),
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
      totalDaysReviewedStaff: num(r["Total No. of Days (Report Reviewed by Sub Focal)"]),
      totalDaysReviewedFocal: num(r["Total No. of Days (Report Reviewed by Focal)"]),
      totalDaysApproved: num(r["Total No. of Days (Report Approved by C, ESWM)"]),
      trackingOfReports: str(r["Tracking of Reports\r\n(to be filled out by Planning Section)"] || r["Tracking of Reports\n(to be filled out by Planning Section)"]),
      statusOfSiteArea: str(r["Status of the \r\nsite area"] || r["Status of the \nsite area"]),
      siteClearing: str(r["1. Site Clearing"]),
      siteGrading: str(r["2. Site Grading and Stabilization of Critical Slopes"]),
      soilCover: str(r["3. Application and Maintenance of Soil Cover"]),
      drainageControl: str(r["4. Provision of Drainage Control System"]),
      leachateManagement: str(r["5. Leachate Management"]),
      gasManagement: str(r["6. Gas Management"]),
      fencingAndSecurity: str(r["7. Fencing and Security"]),
      signages: str(r["8. Putting-up of Signages"]),
      burningProhibition: str(r["9. Prohibition of Burning at the Dumpsite"]),
      remarksAndRecommendation: str(r["Remarks and Recommendation"]),
      docketNoNOV: str(r["Docket No. / NOV"]),
      dateOfIssuanceNOV: str(r["Date of Issuance of NOV"]),
      dateOfTechnicalConference: str(r["Date of Technical Conference"]),
      commitments: str(r["Commitment/s"]),
    }));

  console.log(`Mapped ${records.length} valid records.`);
  const deleted = await OpenDumpsite.deleteMany({});
  console.log(`Cleared ${deleted.deletedCount} existing records.`);
  const inserted = await OpenDumpsite.insertMany(records);
  console.log(`Inserted ${inserted.length} records into open_dumpsites.`);

  await mongoose.disconnect();
  console.log("Done.");
}

seed().catch((err) => { console.error("Seed failed:", err); process.exit(1); });
