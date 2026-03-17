/**
 * Seed: Import Technical Assistance (Barangay) data from Excel
 * Usage: node seeds/seedTechnicalAssistance.js
 */
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");
require("dotenv").config();

const TechnicalAssistance = require("../models/TechnicalAssistance");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const EXCEL_PATH = path.resolve(__dirname, "../../front-end/docs/eswm_universe.xlsx");
const SHEET_NAME = "TECHNICAL ASSISTANCE TO BRGY.";

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

function parseDateStr(val) {
  if (!val) return null;
  if (typeof val === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + val * 86400000);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }
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
      manilaBayArea: str(r["MBA"]),
      enmoAssigned: str(r["ENMO Assigned"]),
      eswmStaff: str(r["ESWM Staff"]),
      focalPerson: str(r["Focal Person"]),
      yearMonitored: num(r["Year Monitored"]),
      dateConducted: parseDateStr(r["Date conducted Technical Assistance"]),
      targetMonth: str(r["Target Month"]),
      iisNumber: str(r["IIS NUMBER C.Y. 2026"]),
      dateReportPrepared: parseDate(r["Date Report Prepared (Submitted to IIS by ENMO)"]),
      dateReportReviewedStaff: parseDate(r["Date Report Reviewed (by ESWM Staff)"]),
      dateReportReviewedFocal: parseDate(r["Date Report Reviewed (by Focal Person)"]),
      dateReportApproved: parseDate(r["Date Report Approved"]),
      totalDaysReportPrepared: num(r["Total No. of Days (Report prepared)"]),
      totalDaysReviewedStaff: num(r["Total No. of Days (Report Reviewed by ESWM Staff)"]),
      totalDaysReviewedFocal: num(r["Total No. of Days (Report Reviewed by Focal)"]),
      totalDaysApproved: num(r["Total No. of Days (Report Approved by C, ESWM)"]),
      trackingOfReports: str(r["Tracking of Reports"]),
      typeOfFacility: str(r["Type of Facility"]),
      status: str(r["Status"]),
      conductedTechCon: str(r["Conducted Tech. Con."]),
      remarks: str(r["Remarks"]),
    }));

  console.log(`Mapped ${records.length} valid records.`);
  const deleted = await TechnicalAssistance.deleteMany({});
  console.log(`Cleared ${deleted.deletedCount} existing records.`);
  const inserted = await TechnicalAssistance.insertMany(records);
  console.log(`Inserted ${inserted.length} records into technical_assistance.`);

  await mongoose.disconnect();
  console.log("Done.");
}

seed().catch((err) => { console.error("Seed failed:", err); process.exit(1); });
