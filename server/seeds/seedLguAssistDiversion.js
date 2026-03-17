/**
 * Seed: Import LGU Assistance & Waste Diversion Records from Excel
 * Usage: node seeds/seedLguAssistDiversion.js
 */
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");
require("dotenv").config();

const LguAssistDiversion = require("../models/LguAssistDiversion");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const EXCEL_PATH = path.resolve(__dirname, "../../front-end/docs/eswm_universe.xlsx");
const SHEET_NAME = "LGU ASST. & WASTE DIVERSION REC";

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
    .filter((r) => r["PROVINCE"] && r["LGU"])
    .map((r) => ({
      province: str(r["PROVINCE"]),
      lgu: str(r["LGU"]),
      enmoAssigned: str(r["ENMO"]),
      eswmStaff: str(r["ESWM STaff"]),
      focalPerson: str(r["FOCAL PERSON"]),
      targetMonth: str(r["TARGET MONTH"]),
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
      trackingOfReports: str(r["Tracking of Reports \r\n(To be filled out by Planning Section)"] || r["Tracking of Reports \n(To be filled out by Planning Section)"]),
      totalWasteGeneration: num(r["TOTAL WASTE GENERATION"]),
      totalWasteDiverted: num(r["TOTAL WASTE DIVERTED"]),
      percentageWasteDiversion: num(r["PERCENTAGE OF WASTE DIVERSION"]),
      statusAccomplishment: str(r["STATUS ACCOMPLISHMENT"]),
    }));

  console.log(`Mapped ${records.length} valid records.`);
  const deleted = await LguAssistDiversion.deleteMany({});
  console.log(`Cleared ${deleted.deletedCount} existing records.`);
  const inserted = await LguAssistDiversion.insertMany(records);
  console.log(`Inserted ${inserted.length} records into lgu_assist_diversion.`);

  await mongoose.disconnect();
  console.log("Done.");
}

seed().catch((err) => { console.error("Seed failed:", err); process.exit(1); });
