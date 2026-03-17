/**
 * Seed script: Import SLF data from Excel into MongoDB
 *
 * Usage:  node seeds/seedSlfFacilities.js
 */
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");
require("dotenv").config();

const SlfFacility = require("../models/SlfFacility");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const EXCEL_PATH = path.resolve(__dirname, "../../front-end/docs/eswm_universe.xlsx");
const SHEET_NAME = "SLF";

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
    .filter((r) => r["Province"] && r["LGU"])
    .map((r) => ({
      province: str(r["Province"]),
      lgu: str(r["LGU"]),
      barangay: str(r["BARANGAY"]),
      manilaBayArea: str(r["Manila Bay Area (MBA)"]),
      congressionalDistrict: str(r["Congressional District"]),
      ownership: str(r["Ownership \r\n(LGU OR PRIVATE)"] || r["Ownership \n(LGU OR PRIVATE)"]),
      latitude: num(r["Lat."]),
      longitude: num(r["Long."]),

      yearStartedOperation: num(r["Year Started Operation"]),
      category: str(r["Category"]),
      volumeCapacity: num(r["Volume Capacity\r\n(tons/day) Based on ECC"] || r["Volume Capacity\n(tons/day) Based on ECC"]),
      noOfLGUServed: num(r["No. of LGU Served"]),

      eccNo: str(r["ECC NO."]),
      dischargePermit: str(r["DISCHARGE PERMIT"]),
      permitToOperate: str(r["PERMIT TO OPERATE"]),
      hazwasteGenerationId: str(r["HAZWASTE GENERATION ID"]),

      targetMonth: str(r["Target Month"]),
      enmo: str(r["ENMO"]),
      eswmStaff: str(r["ESWM Staff"]),
      focalPerson: str(r["Focal Person"]),

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

      trackingOfReports: str(r["Tracking of Reports\r\n(to be filled out of Planning Section)"] || r["Tracking of Reports\n(to be filled out of Planning Section)"]),

      statusOfSLF: str(r["Status of Sanitary Land Fill"]),
      remainingLifeSpan: str(r["Remaining Life Span\r\n(Cell)"] || r["Remaining Life Span\n(Cell)"]),
      actualResidualWasteReceived: num(r["Actual Residual Waste Received\r\n(Kg/day)"] || r["Actual Residual Waste Received\n(Kg/day)"]),
      numberOfCell: num(r["Number of Cell"]),
      estimatedVolumeWaste: num(r["Estimated Volume of waste within the cell\r\n(tons)"] || r["Estimated Volume of waste within the cell\n(tons)"]),
      noOfLeachatePond: num(r["No. of Leachate Pond"]),
      numberOfGasVents: num(r["Number of Gas Vents"]),
      mrfEstablished: str(r["MRF Estabilished within the Facility\r\n(With or Without)"] || r["MRF Estabilished within the Facility\n(With or Without)"]),

      remarksAndRecommendation: str(r["Remarks and\r\nrecommendation"] || r["Remarks and\nrecommendation"]),
      remarksCompliance: str(r["Remarks and Recommendation\r\n(Compliant/ Non-Compliant)"] || r["Remarks and Recommendation\n(Compliant/ Non-Compliant)"]),
      findings: str(r["Findings\r\n(If not compliant)"] || r["Findings\n(If not compliant)"]),

      adviseLetterDateIssued: str(r["Advise Letter/Notice Date Issued"]),
      complianceToAdvise: str(r["Compliance of LGU to Issued Advise/ Letter"]),
      docketNoNOV: str(r["Docket No. / NOV"]),
      dateOfIssuanceNOV: str(r["Date of Issuance of NOV"]),
      dateOfTechnicalConference: str(r["Date of Technical Conference"]),
      commitments: str(r["Commitment/s"]),
      signedDocument: str(r["Signed Document"]),
    }));

  console.log(`Mapped ${records.length} valid records.`);

  const deleted = await SlfFacility.deleteMany({});
  console.log(`Cleared ${deleted.deletedCount} existing records.`);

  const inserted = await SlfFacility.insertMany(records);
  console.log(`Inserted ${inserted.length} records into slf_facilities collection.`);

  await mongoose.disconnect();
  console.log("Done. MongoDB disconnected.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
