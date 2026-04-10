/**
 * Seed script: Import SLF data from per-year Excel files into MongoDB
 *
 * Reads each year's eswm_universe file, maps columns to a common schema,
 * matches facilities across years by LGU name + ECC No, and stores
 * year-specific records. If a facility is absent from a year, a blank
 * placeholder record is stored.
 *
 * Usage:  node seeds/seedSlfFacilities.js
 */
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");
require("dotenv").config();

const SlfFacility = require("../models/SlfFacility");

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

/** Normalize LGU name for cross-year matching */
function normLGU(name) {
  if (!name) return "";
  let s = String(name).trim().toLowerCase();
  // Remove parenthetical suffixes like (BEST), (PWS), (MCWMC), (Florida Enviro Corp), (Eco Protect)
  s = s.replace(/\s*\(.*?\)\s*/g, "");
  // Expand common abbreviations
  s = s.replace(/\bgen\.\s*/g, "general ");
  s = s.replace(/\bma\.\s*/g, "maria ");
  s = s.replace(/\bsta\.\s*/g, "santa ");
  s = s.replace(/\bsto\.\s*/g, "santo ");
  s = s.replace(/\bsjdm\b/g, "san jose del monte");
  // Normalize "City of X" / "X City" → just X
  s = s.replace(/^city\s+of\s+/i, "");
  s = s.replace(/\s+city$/i, "");
  // Strip everything non-alphanumeric
  return s.replace(/[^a-z0-9]/g, "");
}

/* ── Column mappers per file format ─────────────────── */

/** 2022-2024 format: City/Municipality, ECC_NO, etc. */
function mapOlderRow(r) {
  const coords = str(r["Location"]);
  let lat = null,
    lng = null;
  if (coords) {
    const parts = coords.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      lat = parts[0];
      lng = parts[1];
    }
  }
  return {
    province: str(r["Province"]),
    lgu: str(r["City/Municipality"]),
    barangay: str(r["Barangay"]),
    congressionalDistrict: str(r["District"]),
    ownership: str(r["Ownership (LGU or PRIVATE)"]),
    latitude: lat,
    longitude: lng,
    yearStartedOperation: num(r["Year Started"]),
    category: str(r["Category"]),
    volumeCapacity: num(
      pick(r, "Volume Capacity_tons/day base on ECC", "Volume Capacity_tons/day")
    ),
    noOfLGUServed: num(r["No_LGU served"]),
    eccNo: str(r["ECC_NO"]),
    iisNumber: str(r["IIS No."]),
    statusOfSLF: str(r["Current Status"]),
    remarksAndRecommendation: str(r["Remarks"]),
    numberOfCell: num(r["No. of Cell"]),
    estimatedVolumeWaste: num(r["Volume of actual waste"]),
    dateOfMonitoring: parseDate(r["Date of Last Monitoring"]),
    focalPerson: str(r["Name of Inspector"]),
    dischargePermit: null,
    permitToOperate: null,
    hazwasteGenerationId: null,
  };
}

/** 2025-2026 format: LGU, ECC NO., full field set */
function mapNewRow(r) {
  return {
    province: str(r["Province"]),
    lgu: str(r["LGU"]),
    barangay: str(r["BARANGAY"]),
    manilaBayArea: str(r["Manila Bay Area (MBA)"]),
    congressionalDistrict: str(r["Congressional District"]),
    ownership: str(pick(r, "Ownership \n(LGU OR PRIVATE)", "Ownership \r\n(LGU OR PRIVATE)")),
    latitude: num(r["Lat."]),
    longitude: num(r["Long."]),
    yearStartedOperation: num(r["Year Started Operation"]),
    category: str(r["Category"]),
    volumeCapacity: num(
      pick(r, "Volume Capacity\n(tons/day) Based on ECC", "Volume Capacity\r\n(tons/day) Based on ECC")
    ),
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
    trackingOfReports: str(
      pick(
        r,
        "Tracking of Reports\n(to be filled out of Planning Section)",
        "Tracking of Reports\r\n(to be filled out of Planning Section)"
      )
    ),
    statusOfSLF: str(r["Status of Sanitary Land Fill"]),
    remainingLifeSpan: str(
      pick(r, "Remaining Life Span\n(Cell)", "Remaining Life Span\r\n(Cell)")
    ),
    actualResidualWasteReceived: num(
      pick(
        r,
        "Actual Residual Waste Received\n(Kg/day)",
        "Actual Residual Waste Received\r\n(Kg/day)"
      )
    ),
    numberOfCell: num(r["Number of Cell"]),
    estimatedVolumeWaste: num(
      pick(
        r,
        "Estimated Volume of waste within the cell\n(tons)",
        "Estimated Volume of waste within the cell\r\n(tons)"
      )
    ),
    noOfLeachatePond: num(r["No. of Leachate Pond"]),
    numberOfGasVents: num(r["Number of Gas Vents"]),
    mrfEstablished: str(
      pick(
        r,
        "MRF Estabilished within the Facility\n(With or Without)",
        "MRF Estabilished within the Facility\r\n(With or Without)"
      )
    ),
    remarksAndRecommendation: str(
      pick(r, "Remarks and\nrecommendation", "Remarks and\r\nrecommendation")
    ),
    remarksCompliance: str(
      pick(
        r,
        "Remarks and Recommendation\n(Compliant/ Non-Compliant)",
        "Remarks and Recommendation\r\n(Compliant/ Non-Compliant)"
      )
    ),
    findings: str(
      pick(r, "Findings\n(If not compliant)", "Findings\r\n(If not compliant)")
    ),
    adviseLetterDateIssued: str(r["Advise Letter/Notice Date Issued"]),
    complianceToAdvise: str(r["Compliance of LGU to Issued Advise/ Letter"]),
    docketNoNOV: str(r["Docket No. / NOV"]),
    dateOfIssuanceNOV: str(r["Date of Issuance of NOV"]),
    dateOfTechnicalConference: str(r["Date of Technical Conference"]),
    commitments: str(pick(r, "Commitment/s", "Commitments")),
    signedDocument: str(r["Signed Document"]),
  };
}

/* ── Main seed function ──────────────────────────────── */
async function seed() {
  const YEAR_FILES = [
    { year: 2022, file: "eswm_universe_2022.xlsx", format: "old" },
    { year: 2023, file: "eswm_universe_2023.xlsx", format: "old" },
    { year: 2024, file: "eswm_universe_2024.xlsx", format: "old" },
    { year: 2025, file: "eswm_universe_2025.xlsx", format: "new" },
    { year: 2026, file: "eswm_universe.xlsx", format: "new" },
  ];

  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("Connected.");

  // Step 1: Read & map all year files
  const yearDataMap = {};
  for (const { year, file, format } of YEAR_FILES) {
    const wb = XLSX.readFile(path.join(DOCS_DIR, file));
    const slfSheet = wb.SheetNames.find((s) => /^SLF$/i.test(s.trim()));
    if (!slfSheet) {
      console.log(`${year}: No SLF sheet in ${file}, skipping.`);
      yearDataMap[year] = [];
      continue;
    }
    const ws = wb.Sheets[slfSheet];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
    const mapper = format === "old" ? mapOlderRow : mapNewRow;
    const mapped = rows
      .filter((r) => {
        const lgu = format === "old" ? r["City/Municipality"] : r["LGU"];
        return lgu || r["Province"];
      })
      .map(mapper);
    yearDataMap[year] = mapped;
    console.log(`${year}: Read ${mapped.length} SLF records from ${file}`);
  }

  // Step 2: Build master facility list (union across all years)
  // Key = normalized LGU name only (ECC may differ across years)
  const masterFacilities = new Map();
  for (const { year } of YEAR_FILES) {
    for (const rec of yearDataMap[year]) {
      const lguNorm = normLGU(rec.lgu);
      if (!lguNorm) continue;
      const key = lguNorm;
      if (!masterFacilities.has(key)) {
        masterFacilities.set(key, {
          province: rec.province,
          lgu: rec.lgu,
          eccNo: rec.eccNo,
          barangay: rec.barangay,
          latitude: rec.latitude,
          longitude: rec.longitude,
        });
      } else {
        const existing = masterFacilities.get(key);
        if (rec.province) existing.province = rec.province;
        if (rec.lgu) existing.lgu = rec.lgu;
        if (rec.eccNo) existing.eccNo = rec.eccNo;
        if (rec.barangay) existing.barangay = rec.barangay;
        if (rec.latitude) existing.latitude = rec.latitude;
        if (rec.longitude) existing.longitude = rec.longitude;
      }
    }
  }
  console.log(
    `\nMaster facility list: ${masterFacilities.size} unique facilities`
  );

  // Step 3: For each year, match facilities and build records
  const allRecords = [];
  for (const { year } of YEAR_FILES) {
    const yearRecs = yearDataMap[year];

    // Index by normalized LGU key — if multiple rows share the same key,
    // merge them (later row overwrites non-null fields of earlier row)
    const yearIndex = new Map();
    for (const rec of yearRecs) {
      const lguNorm = normLGU(rec.lgu);
      if (!lguNorm) continue;
      const key = lguNorm;
      if (!yearIndex.has(key)) {
        yearIndex.set(key, { ...rec });
      } else {
        // Merge: prefer non-null values from the new row
        const existing = yearIndex.get(key);
        for (const [field, val] of Object.entries(rec)) {
          if (val != null && val !== "") existing[field] = val;
        }
      }
    }

    let matched = 0,
      blank = 0;
    for (const [key, master] of masterFacilities.entries()) {
      const rec = yearIndex.get(key);
      if (rec) {
        // Use canonical LGU name from master list for consistency
        allRecords.push({ ...rec, lgu: master.lgu, dataYear: year });
        matched++;
      } else {
        // Facility NOT in this year's list — blank placeholder
        allRecords.push({
          province: master.province,
          lgu: master.lgu,
          eccNo: master.eccNo,
          barangay: master.barangay,
          latitude: master.latitude,
          longitude: master.longitude,
          dataYear: year,
          statusOfSLF: null,
        });
        blank++;
      }
    }
    console.log(`${year}: ${matched} matched, ${blank} blank placeholders`);
  }

  // Step 4: Clear and insert
  const YEARS = YEAR_FILES.map((yf) => yf.year);
  const deleted = await SlfFacility.deleteMany({
    $or: [{ dataYear: { $in: YEARS } }, { dataYear: null }],
  });
  console.log(`\nCleared ${deleted.deletedCount} existing records.`);

  const inserted = await SlfFacility.insertMany(allRecords);
  console.log(`Inserted ${inserted.length} total records.`);

  for (const y of YEARS) {
    const count = allRecords.filter((r) => r.dataYear === y).length;
    console.log(`  ${y}: ${count} records`);
  }

  await mongoose.disconnect();
  console.log("Done. MongoDB disconnected.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
