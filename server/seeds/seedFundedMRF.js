/**
 * Seed script: Import multi-year FUNDED MRF data from Excel into MongoDB
 *
 * Reads each year's eswm_universe file, maps columns to a common schema,
 * matches MRFs across years by normalized municipality name, and stores
 * year-specific records. If an MRF is absent from a year, a blank
 * placeholder record is stored so the year-switcher still sees it.
 *
 * Usage:  node seeds/seedFundedMRF.js
 */
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");
require("dotenv").config();

const FundedMRF = require("../models/FundedMRF");

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const DOCS_DIR = path.resolve(__dirname, "../../front-end/docs");

/* ── helpers ─────────────────────────────────────────── */
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

/** Try multiple possible key names (handles \r\n vs \n differences) */
function pick(row, ...keys) {
  for (const k of keys) {
    if (row[k] != null && row[k] !== "") return row[k];
    const alt1 = k.replace(/\r\n/g, "\n");
    const alt2 = k.replace(/\n/g, "\r\n");
    if (row[alt1] != null && row[alt1] !== "") return row[alt1];
    if (row[alt2] != null && row[alt2] !== "") return row[alt2];
  }
  return null;
}

/**
 * Normalize municipality name for cross-year matching.
 * Handles common abbreviation differences, City of X / X City, etc.
 */
function normMuni(name) {
  if (!name) return "";
  let s = String(name).trim().toLowerCase();
  // Remove parenthetical suffixes
  s = s.replace(/\s*\(.*?\)\s*/g, "");
  // Remove trailing _A, _B suffixes (e.g. "San Luis_A")
  s = s.replace(/_[a-z]$/i, "");
  // Expand common abbreviations (with or without period)
  s = s.replace(/\bgen\.?\s*/g, "general ");
  s = s.replace(/\bma\.?\s*/g, "maria ");
  s = s.replace(/\bsta\.?\s*/g, "santa ");
  s = s.replace(/\bsto\.?\s*/g, "santo ");
  // Known acronyms
  s = s.replace(/\bcsfp\b/g, "san fernando");
  s = s.replace(/\bcsjdm\b/g, "san jose del monte");
  s = s.replace(/\bsjdm\b/g, "san jose del monte");
  // Normalize "City of X" / "X City" → just X
  s = s.replace(/^city\s+of\s+/i, "");
  s = s.replace(/\s+city$/i, "");
  // Science City of Munoz → munoz
  s = s.replace(/^science\s+city\s+of\s+/i, "");
  // General Mamerto Natividad → General Natividad (shorter canonical form)
  s = s.replace(/general\s+mamerto\s+natividad/g, "general natividad");
  // Gapan City → gapan
  s = s.replace(/gapan\s+city/g, "gapan");
  // Strip everything non-alphanumeric
  return s.replace(/[^a-z0-9]/g, "");
}

/* ── Column mappers per file format ─────────────────── */

/** 2022 format: Province, Municipality, Barangay, Area, Amount Waste Received_kg/day, ... */
function map2022Row(r) {
  const coords = str(r["Location"]);
  let lat = null, lng = null;
  if (coords) {
    const parts = coords.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      lat = parts[0];
      lng = parts[1];
    }
  }
  return {
    province: str(r["Province"]),
    municipality: str(r["Municipality"]),
    barangay: str(r["Barangay"]),
    latitude: lat,
    longitude: lng,
    yearGranted: num(r["Year Assisted"]),
    amountGranted: num(r["Amount Granted_Pesos"]),
    iisNumber: str(r["IIS NO."]),
    statusOfMRF: str(r["CURRENT STATUS"]),
    remarksAndRecommendation: str(r["Remarks"]),
    focalPerson: str(r["Name of Inspector"]),
    totalWasteGeneration: num(r["Amount Waste Received_kg/day"]),
  };
}

/** 2023-2024 format: Province, Municipality, Barangay, Floor Area, Type of MRF, ... */
function map2023Row(r) {
  const coords = str(r["Location"]);
  let lat = null, lng = null;
  if (coords) {
    const parts = coords.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      lat = parts[0];
      lng = parts[1];
    }
  }
  return {
    province: str(r["Province"]),
    municipality: str(r["Municipality"]),
    barangay: str(r["Barangay"]),
    latitude: lat,
    longitude: lng,
    typeOfMRF: str(r["Type of MRF"]),
    yearGranted: num(r["Year Assisted"]),
    amountGranted: num(r["Amount Granted_Pesos"] || r["Ammount Granted"]),
    noOfBrgyServed: num(r["No. of Brgy Served"]),
    typeOfWastesReceived: str(r["Type of Waste Received"]),
    totalWasteGeneration: num(r["Amount Waste Received_kg/day"]),
    quantityOfWasteDiverted: str(r["Total Waste Diverted"]),
    wasteDiversionRate: num(r["Waste Diversion Rate"]),
    iisNumber: str(r["IIS No."]),
    dateOfMonitoring: parseDate(r["Date of Last Monitoring"]),
    statusOfMRF: str(r["CURRENT STATUS"]),
    remarksAndRecommendation: str(r["Remarks"]),
  };
}

/** 2025-2026 format: Full modern schema. */
function mapNewRow(r) {
  return {
    province: str(r["Province"]),
    municipality: str(r["Municipality"]),
    barangay: str(r["Barangay"]),
    manilaBayArea: str(r["Manila Bay Area (MBA)"]),
    congressionalDistrict: str(r["Congressional District"]),
    latitude: num(r["Lat"]),
    longitude: num(r["Long"]),

    typeOfMRF: str(r["Type of MRF"]),
    noFundingSupport: num(r["No Funding Support"]),
    yearGranted: num(r["Year Granted"]),
    amountGranted: num(r["Amount Granted"]),

    enmoAssigned: str(r["ENMO Assigned"]),
    eswmStaff: str(pick(r, "ESWM Staff\n", "ESWM Staff\r\n", "ESWM Staff")),
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

    trackingOfReports: str(pick(r, "Tracking of Reports\n(To be Filled out by Planning Section)", "Tracking of Reports\r\n(To be Filled out by Planning Section)")),

    noOfBrgyServed: num(r["No. of Brgy. Served"]),
    equipmentUsed: str(r["Equipment used in the Operation of the MRF"]),
    typeOfWastesReceived: str(r["Type of wastes received"]),
    quantityOfWasteDiverted: str(r["Quantity of waste diverted (kg)"]),
    totalWasteGeneration: num(r["Total Waste Generation (kg/day)"]),
    wasteDiversionRate: num(pick(r, "Waste Diversion Rate\n(%)", "Waste Diversion Rate\r\n(%)")),

    statusOfMRF: str(r["Status of MRF"]),
    remarksIfNotOperational: str(pick(r, "Remarks\n(If Not Operational)", "Remarks\r\n(If Not Operational)")),
    remarksAndRecommendation: str(pick(r, "Remarks and Recommendation\n(Compliant/ Non-Compliant)", "Remarks and Recommendation\r\n(Compliant/ Non-Compliant)")),
    findings: str(pick(r, "Findings\n(If not compliant)", "Findings\r\n(If not compliant)")),

    adviseLetterDateIssued: str(r["Advise Letter/Notice Date Issued"]),
    complianceToAdvise: str(r["Compliance of LGU to Issued Advise/ Letter"]),
    docketNoNOV: str(r["Docket No. / NOV"]),
    violation: str(pick(r, "Violation\n(Sec. ___ )", "Violation\r\n(Sec. ___ )")),
    dateOfIssuanceNOV: str(r["Date of Issuance of NOV"]),
    dateOfTechnicalConference: str(r["Date of Technical Conference"]),
    commitments: str(r["Commitment/s"]),
    signedDocument: str(r["Signed Document"]),
  };
}

/* ── Main seed function ──────────────────────────────── */
async function seed() {
  const YEAR_FILES = [
    { year: 2022, file: "eswm_universe_2022.xlsx", sheet: "FUNDED MRF", format: "2022" },
    { year: 2023, file: "eswm_universe_2023.xlsx", sheet: "FUNDED MRF", format: "2023" },
    { year: 2024, file: "eswm_universe_2024.xlsx", sheet: "FUNDED MRF", format: "2023" },
    { year: 2025, file: "eswm_universe_2025.xlsx", sheet: "MRF",        format: "new" },
    { year: 2026, file: "eswm_universe.xlsx",      sheet: "FUNDED MRF", format: "new" },
  ];

  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("Connected.");

  // Step 1: Read & map all year files
  const yearDataMap = {};
  for (const { year, file, sheet, format } of YEAR_FILES) {
    const wb = XLSX.readFile(path.join(DOCS_DIR, file));
    const sheetName = wb.SheetNames.find((s) =>
      s.trim().toLowerCase() === sheet.toLowerCase()
    );
    if (!sheetName) {
      console.log(`${year}: No "${sheet}" sheet in ${file}. Available: ${wb.SheetNames.join(", ")}`);
      yearDataMap[year] = [];
      continue;
    }
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null });

    let mapper;
    if (format === "2022") mapper = map2022Row;
    else if (format === "2023") mapper = map2023Row;
    else mapper = mapNewRow;

    const mapped = rows
      .filter((r) => r["Province"] || r["Municipality"])
      .map(mapper);
    yearDataMap[year] = mapped;
    console.log(`${year}: Read ${mapped.length} MRF records from ${file} [${sheetName}]`);
  }

  // Step 2: Build master MRF list (union across all years)
  // Key = normalized municipality name
  const masterMRFs = new Map();
  for (const { year } of YEAR_FILES) {
    for (const rec of yearDataMap[year]) {
      const muniNorm = normMuni(rec.municipality);
      if (!muniNorm) continue;
      const key = muniNorm;
      if (!masterMRFs.has(key)) {
        masterMRFs.set(key, {
          province: rec.province,
          municipality: rec.municipality,
          barangay: rec.barangay,
          manilaBayArea: rec.manilaBayArea || null,
          congressionalDistrict: rec.congressionalDistrict || null,
          latitude: rec.latitude,
          longitude: rec.longitude,
        });
      } else {
        // Update with latest year's canonical data
        const existing = masterMRFs.get(key);
        if (rec.province) existing.province = rec.province;
        if (rec.municipality) existing.municipality = rec.municipality;
        if (rec.barangay) existing.barangay = rec.barangay;
        if (rec.manilaBayArea) existing.manilaBayArea = rec.manilaBayArea;
        if (rec.congressionalDistrict) existing.congressionalDistrict = rec.congressionalDistrict;
        if (rec.latitude) existing.latitude = rec.latitude;
        if (rec.longitude) existing.longitude = rec.longitude;
      }
    }
  }
  console.log(`\nMaster MRF list: ${masterMRFs.size} unique MRFs`);

  // Step 3: For each year, match MRFs and build records
  const allRecords = [];
  for (const { year } of YEAR_FILES) {
    const yearRecs = yearDataMap[year];

    // Index by normalized municipality — if multiple rows share the same key,
    // merge them (later row overwrites non-null fields)
    const yearIndex = new Map();
    for (const rec of yearRecs) {
      const muniNorm = normMuni(rec.municipality);
      if (!muniNorm) continue;
      const key = muniNorm;
      if (!yearIndex.has(key)) {
        yearIndex.set(key, { ...rec });
      } else {
        const existing = yearIndex.get(key);
        for (const [field, val] of Object.entries(rec)) {
          if (val != null && val !== "") existing[field] = val;
        }
      }
    }

    let matched = 0, blank = 0;
    for (const [key, master] of masterMRFs.entries()) {
      const rec = yearIndex.get(key);
      if (rec) {
        // Use canonical name from master list for consistency
        allRecords.push({
          ...rec,
          municipality: master.municipality,
          dataYear: year,
        });
        matched++;
      } else {
        // MRF NOT in this year's data — blank placeholder
        allRecords.push({
          province: master.province,
          municipality: master.municipality,
          barangay: master.barangay,
          manilaBayArea: master.manilaBayArea,
          congressionalDistrict: master.congressionalDistrict,
          latitude: master.latitude,
          longitude: master.longitude,
          dataYear: year,
          statusOfMRF: null,
        });
        blank++;
      }
    }
    console.log(`${year}: ${matched} matched, ${blank} blank placeholders`);
  }

  // Step 4: Clear and insert
  const YEARS = YEAR_FILES.map((yf) => yf.year);
  const deleted = await FundedMRF.deleteMany({
    $or: [{ dataYear: { $in: YEARS } }, { dataYear: null }],
  });
  console.log(`\nCleared ${deleted.deletedCount} existing records.`);

  const inserted = await FundedMRF.insertMany(allRecords);
  console.log(`Inserted ${inserted.length} total records.`);

  for (const y of YEARS) {
    const cnt = allRecords.filter((r) => r.dataYear === y).length;
    console.log(`  ${y}: ${cnt} records`);
  }

  await mongoose.disconnect();
  console.log("\nDone. Disconnected.");
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
