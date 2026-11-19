/**
 * Seeds "Demonstration Training SLF": an EMPTY test (dummy) facility for live
 * demonstrations of the whole SLF Portal journey, from registering an account to
 * submitting waste data.
 *
 *   node seeds/seedTrainingFacility.js            create, or reset cells to empty
 *   node seeds/seedTrainingFacility.js --dry-run  print what would be written
 *
 * How it is used (docs/files/SLF_Portal_Demo_*):
 *   1. A presenter registers a NEW account on the portal sign-up page.
 *   2. A developer approves it in Portal Users with "Training / test account"
 *      ticked, assigning this facility. The account becomes a test account too.
 *   3. The account encodes a baseline and submits waste data, manually and by
 *      uploading a system-generated (weighbridge) file.
 *
 * Isolation: the facility is `isDummy: true`. Baselines and submissions on a dummy
 * facility are stamped `isDummy` (routes/dataSLF.js), and every report, dashboard
 * and count excludes `isDummy`, so nothing from a demonstration reaches production
 * figures. The script matches only on this facility's own name + isDummy, so it can
 * never touch a production record. Nothing here runs on server boot.
 */
require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");

// Resolvable from the repo (seeds/) or from a copy run elsewhere against a server
// checkout (SEED_BASE=<server dir>).
const BASE = process.env.SEED_BASE || path.join(__dirname, "..");
const SlfFacility = require(path.join(BASE, "models/SlfFacility"));

const FACILITY_NAME = "Demonstration Training SLF";

// Fictional facility, real-looking numbers. Cells are EMPTY (no fill, no
// baseline) so the demonstration encodes the baseline from scratch:
//   Cell 1  Active, Residual            80,000 m³
//   Cell 2  Active, Residual            60,000 m³
//   Cell 3  Active, Treated Haz Waste   15,000 m³
//   Cell 4  Used/Completed, Residual    50,000 m³  (a closed cell for the baseline)
const FACILITY = {
  isDummy: true,
  deletedAt: null,
  dataYear: 2026,
  province: "Pampanga",
  lgu: FACILITY_NAME,
  barangay: "Barangay Demo",
  ownership: "Private",
  category: "Cat 2",
  statusOfSLF: "Operational",
  yearStartedOperation: 2019,
  remainingLifeSpan: "8 years",
  latitude: 15.0286,
  longitude: 120.6898,

  volumeCapacity: 205000,
  volumeCapacityUnit: "m³",
  receivingVolumeCapacity: 155000,
  receivingVolumeCapacityUnit: "m³",
  actualResidualWasteReceived: 0,
  wasteReceivedUnit: "m³",

  eccNo: "ECC-R03-TRAIN-0001",
  permitToOperate: "PTO-R03-TRAIN-2026",
  permitToOperateValidity: new Date("2027-06-30"),
  permitToOperateStatus: "New",
  dischargePermit: "DP-R03-TRAIN-2026",
  dischargePermitValidity: new Date("2027-06-30"),
  dischargePermitStatus: "New",
  hazwasteGenerationId: "HW-R03-TRAIN-0001",
  focalPerson: "Training Focal Person (Demo)",

  numberOfCell: 4,
  cellNames: ["Cell 1", "Cell 2", "Cell 3", "Cell 4"],
  cellCapacities: [80000, 60000, 15000, 50000],
  cellCapacityUnits: ["m³", "m³", "m³", "m³"],
  cellStatuses: ["Active Cell", "Active Cell", "Active Cell", "Used/Completed"],
  cellTypes: ["Residual", "Residual", "Treated Haz Waste", "Residual"],
  cellSubmissionAllowed: [true, true, true, false],
  cellNotes: ["", "", "Treated hazardous waste only", "Closed 2024"],
  cellFillValues: [0, 0, 0, 0],
  cellBaselineValues: [0, 0, 0, 0],
};

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  const { connectMongo } = require(path.join(BASE, "config/mongo"));
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
  const dnsServers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1").split(",").map((s) => s.trim()).filter(Boolean);
  await connectMongo(uri, { dnsServers });

  let facility = await SlfFacility.findOne({ lgu: FACILITY_NAME, isDummy: true });
  console.log(facility ? `Found existing: ${facility._id}` : "Not found: will create.");
  if (dryRun) {
    console.log(JSON.stringify(FACILITY, null, 2));
  } else if (facility) {
    Object.assign(facility, FACILITY);
    await facility.save();
    console.log(`Facility reset: ${facility.lgu} (${facility._id})`);
  } else {
    facility = await SlfFacility.create(FACILITY);
    console.log(`Facility created: ${facility.lgu} (${facility._id})`);
  }
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("Seed failed:", err.message);
  try { await mongoose.disconnect(); } catch { /* already closed */ }
  process.exit(1);
});
