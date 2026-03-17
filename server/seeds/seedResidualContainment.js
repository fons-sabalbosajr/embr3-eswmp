/**
 * Seed: Import Residual Containment Area (RCA) data from Excel
 * Usage: node seeds/seedResidualContainment.js
 */
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");
require("dotenv").config();

const ResidualContainment = require("../models/ResidualContainment");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const EXCEL_PATH = path.resolve(__dirname, "../../front-end/docs/eswm_universe.xlsx");
const SHEET_NAME = "RCA";

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
      latitude: num(r["Lat"]),
      longitude: num(r["Long"]),
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
      trackingOfReports: str(r["Tracking of Reports"]),
      statusOfFacility: str(r["Status\r\nof the Facility"] || r["Status\nof the Facility"]),
      facilityOrBin: str(r["Facility or Bin"]),
      numberOfBinUsed: num(r["Number of Bin used"]),
      totalFloorArea: num(r["Total Floor Area\r\n(sq.m)"] || r["Total Floor Area\n(sq.m)"]),
      dateOperationalized: num(r["Date \r\nOperationalized"] || r["Date \nOperationalized"]),
      actualWasteReceived: str(r["Actual Waste Received\r\n(tons per day)"] || r["Actual Waste Received\n(tons per day)"]),
      rcaStorageCapacity: str(r["RCA Storage Capacity\r\n(cm3)"] || r["RCA Storage Capacity\n(cm3)"]),
      totalVolumeResidualWaste: num(r["Total Volume of Residual waste stored"]),
      dateOfHauling: parseDate(r["Date of hauling to an SLF"]),
      volumeOfWasteHauled: str(r["Volume of Waste hauled\r\n(tons)"] || r["Volume of Waste hauled\n(tons)"]),
      hauler: str(r["Hauler"]),
      finalDisposal: str(r["Final Disposal"]),
      coProcessingFacility: str(r["Co-Processing\r\nFacility"] || r["Co-Processing\nFacility"]),
      noOfBarangayServed: num(r["No. of Barangay Served"]),
      remarksIfNotOperational: str(r["Remarks\r\n(If Not Operational)"] || r["Remarks\n(If Not Operational)"]),
      remarksAndRecommendation: str(r["Remarks and Recommendation\r\n(Compliant/ Non-Compliant)"] || r["Remarks and Recommendation\n(Compliant/ Non-Compliant)"]),
      findings: str(r["Findings\r\n(If not compliant)"] || r["Findings\n(If not compliant)"]),
      adviseLetterDateIssued: str(r["Advise Letter/Notice Date Issued"]),
      complianceToAdvise: str(r["Compliance of LGU to Issued Advise/ Letter"]),
      docketNoNOV: str(r["Docket No. / NOV"]),
      violation: str(r["Violation"]),
      dateOfIssuanceNOV: str(r["Date of Issuance of NOV"]),
      dateOfTechnicalConference: str(r["Date of Technical Conference"]),
      commitments: str(r["Commitment/s"]),
      signedReport: str(r["Signed Report"]),
    }));

  console.log(`Mapped ${records.length} valid records.`);
  const deleted = await ResidualContainment.deleteMany({});
  console.log(`Cleared ${deleted.deletedCount} existing records.`);
  const inserted = await ResidualContainment.insertMany(records);
  console.log(`Inserted ${inserted.length} records into residual_containment.`);

  await mongoose.disconnect();
  console.log("Done.");
}

seed().catch((err) => { console.error("Seed failed:", err); process.exit(1); });
