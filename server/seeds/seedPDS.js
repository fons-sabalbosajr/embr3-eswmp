/**
 * Seed: Import PDS data from Excel
 * Usage: node seeds/seedPDS.js
 */
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");
require("dotenv").config();

const ProjectDescScoping = require("../models/ProjectDescScoping");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const EXCEL_PATH = path.resolve(__dirname, "../../front-end/docs/eswm_universe.xlsx");
const SHEET_NAME = "PDS";

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
      mailingAddress: str(r["Mailing Address"]),
      locationOfFacility: str(r["Location of the Facility"]),
      dateOfInstallation: str(r["Date of Installation"]),
      manilaBayArea: str(r["Manila Bay Area (MBA)"]),
      latitude: num(r["Lat"]),
      longitude: num(r["Long"]),
      contractWithTSD: str(r["Contract with TSD (TSD No.)"]),
      numberOfBinsInstalled: num(r["Number of Bins Installed"]),
      hazwasteGeneratorCert: str(r["Hazardous Waste Generator's Registration Certificate"]),
      ecc: str(r["ECC (if applicable)"]),
      wastewaterDischargePermit: str(r["Wastewater Discharge Permit (if applicable)"]),
      permitToOperateAPSI: str(r["PERMIT TO OPERATE AIR POLLUTION SOURCE INSTALLATIONS (APSI) (if applicable)"]),
      enmoAssigned: str(r["ENMO Assigned"]),
      eswmStaff: str(r["ESWM Staff"]),
      focalPerson: str(r["Focal Person"]),
      targetMonth: str(r["\r\nTarget Month"] || r["\nTarget Month"] || r["Target Month"]),
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
      trackingOfReports: str(r["Tracking of Reports"]),
      statusOfPDS: str(r["Status of PDS Facility"]),
      hwGeneration: str(r["HW Generation/Collectedof the reporting month\r\n (MT) "] || r["HW Generation/Collectedof the reporting month\n (MT) "]),
      remarks: str(r["Remarks"]),
      adviseLetterIssued: str(r["Advise Letter Issued"]),
      complianceToAdvise: str(r["Compliance of LGU to Issued Advise/ Letter"]),
      signedDocument: str(r["Signed Document"]),
    }));

  console.log(`Mapped ${records.length} valid records.`);
  const deleted = await ProjectDescScoping.deleteMany({});
  console.log(`Cleared ${deleted.deletedCount} existing records.`);
  const inserted = await ProjectDescScoping.insertMany(records);
  console.log(`Inserted ${inserted.length} records into project_desc_scoping.`);

  await mongoose.disconnect();
  console.log("Done.");
}

seed().catch((err) => { console.error("Seed failed:", err); process.exit(1); });
