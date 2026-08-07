/**
 * Seeds the sealed DEMONSTRATION environment: one admin account, one portal
 * account, and one fictional SLF facility for the portal account to operate.
 *
 *   node seeds/seedDemoAccounts.js          create or update the demo env
 *   node seeds/seedDemoAccounts.js --reset  delete demo data, then re-create
 *
 * ── Isolation contract ──────────────────────────────────────────────────────
 *
 *   • Accounts carry `isDemo: true`  → hidden from Account Management and the
 *     Portal Users list; their sessions get server-side value masking.
 *   • All demo DATA carries `isDummy: true` → inherits the isolation that every
 *     analytics/report/dashboard query in the app already applies
 *     (`isDummy: { $ne: true }`), so demo figures can never reach production
 *     statistics, approvals or exports.
 *
 * The script is IDEMPOTENT and matches strictly on the demo e-mail addresses,
 * so re-running it can never touch a production user. Nothing here runs on
 * server boot — seeding a login is a deliberate, explicit act.
 *
 * ── Credentials ─────────────────────────────────────────────────────────────
 *
 * Passwords come from the environment so a real deployment never ships a
 * password that is published in source control:
 *
 *   DEMO_ADMIN_PASSWORD    default: see DEFAULT_ADMIN_PASSWORD below
 *   DEMO_PORTAL_PASSWORD   default: see DEFAULT_PORTAL_PASSWORD below
 *
 * Set both in server/.env before demonstrating on anything internet-facing.
 */

require("dotenv").config();
const mongoose = require("mongoose");

const User = require("../models/User");
const UserPortal = require("../models/UserPortal");
const SlfFacility = require("../models/SlfFacility");
const SlfClient = require("../models/SlfClient");

// Fixed identities so the script can find and update its own rows without ever
// pattern-matching a production account.
const DEMO_ADMIN_EMAIL = "demo.admin@eswmp-demo.local";
const DEMO_PORTAL_EMAIL = "demo.portal@eswmp-demo.local";
const DEMO_ADMIN_USERNAME = "demo.admin";
const DEMO_PORTAL_USERNAME = "demo.portal";

const DEFAULT_ADMIN_PASSWORD = "EswmpDemo!Admin2026";
const DEFAULT_PORTAL_PASSWORD = "EswmpDemo!Portal2026";

const adminPassword = process.env.DEMO_ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
const portalPassword = process.env.DEMO_PORTAL_PASSWORD || DEFAULT_PORTAL_PASSWORD;

/**
 * A fictional facility. The names are invented and deliberately carry a
 * "Demonstration" marker so nobody mistakes this for a real LGU record, while
 * the numbers stay realistic enough to drive the gauges, capacity bands and
 * approval workflow through their full range.
 *
 * Cell mix is chosen to exercise every visual state at once:
 *   Cell 1  Used/Completed   100%  → completed styling
 *   Cell 2  Active           ~78%  → amber "elevated" band
 *   Cell 3  Active           ~94%  → red "near full" band + over-capacity notes
 *   Cell 4  Active (haz)     ~41%  → green band, hazardous type colouring
 *   Cell 5  Under Constr.      0%  → dashed / inactive styling
 */
const DEMO_FACILITY = {
  isDummy: true,
  dataYear: new Date().getFullYear(),
  province: "Bulacan",
  lgu: "Demonstration Valley",
  barangay: "San Ejemplo",
  ownership: "Private",
  latitude: 14.9512,
  longitude: 120.9012,
  yearStartedOperation: 2016,
  category: "Cat 3",
  statusOfSLF: "Operational",
  remainingLifeSpan: "6 years",

  volumeCapacity: 480000,
  volumeCapacityUnit: "m³",
  receivingVolumeCapacity: 265000,
  receivingVolumeCapacityUnit: "m³",
  actualResidualWasteReceived: 158420.5,
  wasteReceivedUnit: "m³",

  noOfLGUServed: 4,
  lguServedList: [
    "Demonstration Valley",
    "San Ejemplo",
    "Villa Muestra",
    "Bayan ng Halimbawa",
  ],
  privateCompaniesServed: [
    "Northgate Sample Logistics Inc.",
    "Vermillion Test Packaging Corp.",
  ],

  eccNo: "ECC-R03-DEMO-0001",
  dischargePermit: "DP-R03-DEMO-2210",
  dischargePermitValidity: new Date("2027-03-31"),
  dischargePermitStatus: "Renewal",
  permitToOperate: "PTO-R03-DEMO-1184",
  permitToOperateValidity: new Date("2026-11-30"),
  permitToOperateStatus: "New",
  hazwasteGenerationId: "HW-R03-DEMO-77213",

  enmo: "Demonstration ENMO",
  eswmStaff: "R. Villanueva (Demo)",
  focalPerson: "M. Castillo (Demo)",

  numberOfCell: 5,
  cellNames: ["Cell 1", "Cell 2", "Cell 3", "Cell 4", "Cell 5"],
  cellCapacities: [90000, 110000, 95000, 60000, 125000],
  cellCapacityUnits: ["m³", "m³", "m³", "m³", "m³"],
  cellStatuses: [
    "Used/Completed",
    "Active Cell",
    "Active Cell",
    "Active Cell",
    "Under Construction",
  ],
  cellTypes: ["Residual", "Residual", "Residual", "Treated Haz Waste", "Residual"],
  cellSubmissionAllowed: [false, true, true, true, false],
  cellNotes: ["Closed 2023", "", "Approaching capacity", "", "Target opening 2027"],
  // Baseline + submitted so the gauge segments render both palette colours.
  cellFillValues: [90000, 85800, 89300, 24600, 0],
  cellBaselineValues: [90000, 61000, 70400, 18200, 0],
};

/**
 * Client roster for the demo facility — the LGUs and private firms it serves,
 * plus the hauling contractor moving each one's waste. Names are invented and
 * carry obvious sample markers; the LGU/Private mix exists so the Client
 * Relationship and Clients-Served views both have something to group by.
 */
const DEMO_CLIENTS = [
  { name: "Demonstration Valley", type: "LGU", hauler: "Northwind Sample Haulers" },
  { name: "San Ejemplo", type: "LGU", hauler: "Northwind Sample Haulers" },
  { name: "Villa Muestra", type: "LGU", hauler: "Copperleaf Demo Transport" },
  { name: "Bayan ng Halimbawa", type: "LGU", hauler: "Copperleaf Demo Transport" },
  {
    name: "Northgate Sample Logistics Inc.",
    type: "Private Sector",
    hauler: "Northgate In-House Fleet (Demo)",
  },
  {
    name: "Vermillion Test Packaging Corp.",
    type: "Private Sector",
    hauler: "Copperleaf Demo Transport",
  },
];

const normalize = (value) => String(value || "").trim().toLowerCase();

async function run() {
  const reset = process.argv.includes("--reset");

  // Connect through the app's own connector, NOT mongoose.connect().
  //
  // Atlas SRV lookups fail in this deployment's network (see config/dnsResolver.js
  // and the "Fix MongoDB SRV resolution" work); connectMongo applies the DNS
  // override and retry policy that makes the connection succeed. A plain
  // mongoose.connect() here dies with `querySrv ECONNREFUSED` and the seed
  // silently never runs — which is exactly why the demo accounts did not exist.
  const { connectMongo } = require("../config/mongo");

  // The app reads MONGODB_URI; MONGO_URI is accepted as an alias so a local
  // override still works.
  const uri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    "mongodb://127.0.0.1:27017/embr3_eswmp";
  const dnsServers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  await connectMongo(uri, { dnsServers });
  console.log("Connected.");

  if (reset) {
    const a = await User.deleteMany({ email: DEMO_ADMIN_EMAIL, isDemo: true });
    const p = await UserPortal.deleteMany({ email: DEMO_PORTAL_EMAIL, isDemo: true });
    const f = await SlfFacility.deleteMany({ lgu: DEMO_FACILITY.lgu, isDummy: true });
    const c = await SlfClient.deleteMany({
      normalizedName: { $in: DEMO_CLIENTS.map((x) => normalize(x.name)) },
      isDummy: true,
    });
    console.log(
      `Reset: removed ${a.deletedCount} admin, ${p.deletedCount} portal, ` +
        `${f.deletedCount} facility, ${c.deletedCount} client row(s).`,
    );
  }

  // ── Facility ───────────────────────────────────────────────────────────────
  // Matched on lgu + isDummy so it can never collide with a production record.
  let facility = await SlfFacility.findOne({
    lgu: DEMO_FACILITY.lgu,
    isDummy: true,
  });
  if (facility) {
    Object.assign(facility, DEMO_FACILITY);
    await facility.save();
    console.log(`Facility updated: ${facility.lgu} (${facility._id})`);
  } else {
    facility = await SlfFacility.create(DEMO_FACILITY);
    console.log(`Facility created: ${facility.lgu} (${facility._id})`);
  }

  // ── Admin demo account ─────────────────────────────────────────────────────
  // Full admin permissions so every module is navigable; the schema default
  // already grants view/edit/delete across the board.
  let admin = await User.findOne({ email: DEMO_ADMIN_EMAIL });
  if (!admin) admin = new User({ email: DEMO_ADMIN_EMAIL });
  admin.firstName = "Demonstration";
  admin.lastName = "Administrator";
  admin.username = DEMO_ADMIN_USERNAME;
  admin.role = "admin";
  admin.position = "Demo Administrator";
  admin.designation = "System Demonstration";
  admin.isVerified = true;
  admin.isApproved = true;
  admin.isDemo = true;
  admin.password = adminPassword; // pre-save hook hashes it
  await admin.save();
  console.log(`Admin demo account ready: ${admin.email}`);

  // ── Portal demo account ────────────────────────────────────────────────────
  let portal = await UserPortal.findOne({ email: DEMO_PORTAL_EMAIL });
  if (!portal) portal = new UserPortal({ email: DEMO_PORTAL_EMAIL });
  portal.firstName = "Demonstration";
  portal.lastName = "Portal User";
  portal.username = DEMO_PORTAL_USERNAME;
  portal.contactNumber = "0917-000-0000";
  portal.companyName = "Demonstration Valley Sanitary Landfill";
  portal.status = "approved";
  portal.isVerified = true;
  portal.isDummy = true; // data isolation
  portal.isDemo = true; // account isolation + masking
  portal.assignedSlf = [facility._id];
  portal.assignedSlfName = [facility.lgu];
  portal.password = portalPassword; // pre-save hook hashes it
  await portal.save();
  console.log(`Portal demo account ready: ${portal.email}`);

  // ── Clients / haulers ──────────────────────────────────────────────────────
  // Written after the portal account exists so each row can be linked to it,
  // which is what makes the Client Relationship views render for the demo.
  let clientsWritten = 0;
  for (const entry of DEMO_CLIENTS) {
    const payload = {
      ...entry,
      normalizedName: normalize(entry.name),
      normalizedHauler: normalize(entry.hauler),
      portalUser: portal._id,
      portalUserEmail: DEMO_PORTAL_EMAIL,
      portalUserName: `${portal.firstName} ${portal.lastName}`,
      source: "admin-managed",
      isDummy: true,
    };
    const existing = await SlfClient.findOne({
      normalizedName: payload.normalizedName,
      isDummy: true,
    });
    if (existing) {
      Object.assign(existing, payload);
      await existing.save();
    } else {
      await SlfClient.create(payload);
    }
    clientsWritten += 1;
  }
  console.log(`Clients/haulers ready: ${clientsWritten}`);

  console.log("\n─────────── DEMO CREDENTIALS ───────────");
  console.log(`Admin  : ${DEMO_ADMIN_EMAIL}  /  ${adminPassword}`);
  console.log(`Portal : ${DEMO_PORTAL_EMAIL}  /  ${portalPassword}`);
  console.log("────────────────────────────────────────");
  console.log("Override via DEMO_ADMIN_PASSWORD / DEMO_PORTAL_PASSWORD in .env.");

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("Seed failed:", err.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
