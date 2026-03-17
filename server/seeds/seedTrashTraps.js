/**
 * Seed script: Import TRASH TRAP data from Excel into MongoDB
 *
 * Usage:  node seeds/seedTrashTraps.js
 */
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");
require("dotenv").config();

const TrashTrap = require("../models/TrashTrap");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const EXCEL_PATH = path.resolve(__dirname, "../../front-end/docs/eswm_universe.xlsx");
const SHEET_NAME = "TRASH TRAP";

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
  const cleaned = String(val).replace(/,\s*/g, "").trim();
  const n = Number(cleaned);
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
      province: str(r["Province"]),
      municipality: str(r["Municipality"]),
      barangay: str(r["Barangay"]),
      manilaBayArea: str(r["Manila Bay Area"]),
      latitude: num(r["Lat"]),
      longitude: num(r["Long"]),

      dateInstalled: parseDate(r["Date Installed"]),

      targetMonth: str(r["\r\nTarget Month"] || r["\nTarget Month"] || r["Target Month"]),
      enmoAssigned: str(r["ENMO Assigned"]),
      eswmStaff: str(r["ESWM Staff"]),
      focalPerson: str(r["Focal Person"]),

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

      statusOfTrashTraps: str(r["Status of Trash Traps"]),
      noOfTrashTrapsHDPE: num(r["No. of Trash Traps HDPE Floater"]),
      statusOfWasteLifter: str(r["Status of Waste Lifter"]),
      statusOfPlasticBoat: str(r["Status of Plastic Boat"]),
      estimatedVolumeWasteHauled: num(r["Estimated Volume of waste hauled\r\n(kg)"] || r["Estimated Volume of waste hauled\n(kg)"]),
      dateOfLastHauling: parseDate(r["Date of Last Hauling"]),

      remarks: str(r["Remarks"]),
      adviseLetterDateIssued: str(r["Advise Letter/Notice Date Issued"]),
      complianceToAdvise: str(r["Compliance to Advise/ Letter Issued"]),
      remarks2: str(r["Remarks_1"]),
      signedReport: str(r["Signed Report"]),
    }));

  console.log(`Mapped ${records.length} valid records.`);

  const deleted = await TrashTrap.deleteMany({});
  console.log(`Cleared ${deleted.deletedCount} existing records.`);

  const inserted = await TrashTrap.insertMany(records);
  console.log(`Inserted ${inserted.length} records into trash_traps collection.`);

  await mongoose.disconnect();
  console.log("Done. MongoDB disconnected.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
