/**
 * Seed historical ESWM data from the past Universe Excel files (2022–2025).
 * Data was extracted from:
 *   - eswm_universe_2022.xlsx
 *   - eswm_universe_2023.xlsx
 *   - eswm_universe_2024.xlsx
 *   - eswm_universe.xlsx (2025 baseline)
 *
 * Run:  node seeds/seedDataHistory.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const DataHistory = require("../models/DataHistory");

const HISTORY = [
  // ───────────── 2022 ─────────────
  {
    year: 2022,
    category: "tenYearPlan",
    totalRecords: 137,
    byProvince: [
      { province: "Aurora", count: 9 },
      { province: "Bataan", count: 13 },
      { province: "Bulacan", count: 25 },
      { province: "Nueva Ecija", count: 33 },
      { province: "Pampanga", count: 23 },
      { province: "Tarlac", count: 19 },
      { province: "Zambales", count: 15 },
    ],
    byStatus: [
      { status: "Approved", count: 123 },
      { status: "Endorsed NSWMC", count: 5 },
      { status: "For LGU Revision", count: 9 },
    ],
    additionalMetrics: {
      byPlanType: { "Municipal/City": 130, Provincial: 7 },
    },
  },
  {
    year: 2022,
    category: "slf",
    totalRecords: 27,
    byProvince: [
      { province: "Aurora", count: 6 },
      { province: "Bataan", count: 4 },
      { province: "Bulacan", count: 4 },
      { province: "Nueva Ecija", count: 5 },
      { province: "Pampanga", count: 2 },
      { province: "Tarlac", count: 1 },
      { province: "Zambales", count: 5 },
    ],
    byStatus: [
      { status: "Operational", count: 14 },
      { status: "On Going Construction", count: 4 },
      { status: "Closed", count: 7 },
      { status: "Non Operational", count: 2 },
    ],
    additionalMetrics: {
      byCategory: { "Cat 1": 15, "Cat 2": 1, "Cat 4": 7 },
      byOwnership: { LGU: 23, Private: 1 },
    },
  },
  {
    year: 2022,
    category: "fundedMrf",
    totalRecords: 75,
    byProvince: [
      { province: "Aurora", count: 7 },
      { province: "Bataan", count: 5 },
      { province: "Bulacan", count: 23 },
      { province: "Nueva Ecija", count: 17 },
      { province: "Pampanga", count: 10 },
      { province: "Tarlac", count: 7 },
      { province: "Zambales", count: 6 },
    ],
    byStatus: [
      { status: "Operational", count: 58 },
      { status: "Non-Operational", count: 12 },
      { status: "Under Construction", count: 2 },
      { status: "Others", count: 3 },
    ],
  },
  {
    year: 2022,
    category: "lguMrf",
    totalRecords: 74,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2022,
    category: "trashTraps",
    totalRecords: 1,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2022,
    category: "swmEquipment",
    totalRecords: 125,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2022,
    category: "residualContainment",
    totalRecords: 17,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2022,
    category: "transferStation",
    totalRecords: 52,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2022,
    category: "openDumpsite",
    totalRecords: 1,
    byProvince: [],
    byStatus: [],
  },

  // ───────────── 2023 ─────────────
  {
    year: 2023,
    category: "tenYearPlan",
    totalRecords: 137,
    byProvince: [
      { province: "Aurora", count: 9 },
      { province: "Bataan", count: 13 },
      { province: "Bulacan", count: 25 },
      { province: "Nueva Ecija", count: 33 },
      { province: "Pampanga", count: 23 },
      { province: "Tarlac", count: 19 },
      { province: "Zambales", count: 15 },
    ],
    byStatus: [
      { status: "Approved", count: 129 },
      { status: "Endorsed NSWMC", count: 6 },
      { status: "For LGU Revision", count: 2 },
    ],
    additionalMetrics: {
      byPlanType: { "Municipal/City": 130, Provincial: 7 },
    },
  },
  {
    year: 2023,
    category: "slf",
    totalRecords: 28,
    byProvince: [
      { province: "Aurora", count: 7 },
      { province: "Bataan", count: 4 },
      { province: "Bulacan", count: 4 },
      { province: "Nueva Ecija", count: 5 },
      { province: "Pampanga", count: 2 },
      { province: "Tarlac", count: 1 },
      { province: "Zambales", count: 5 },
    ],
    byStatus: [
      { status: "Operational", count: 15 },
      { status: "On Going Construction", count: 3 },
      { status: "Closed", count: 7 },
      { status: "Non Operational", count: 3 },
    ],
    additionalMetrics: {
      byCategory: { "Cat 1": 13, "Cat 2": 2, "Cat 4": 8 },
      byOwnership: { LGU: 25, Private: 3 },
    },
  },
  {
    year: 2023,
    category: "fundedMrf",
    totalRecords: 203,
    byProvince: [
      { province: "Aurora", count: 20 },
      { province: "Bataan", count: 26 },
      { province: "Bulacan", count: 48 },
      { province: "Nueva Ecija", count: 44 },
      { province: "Pampanga", count: 24 },
      { province: "Tarlac", count: 19 },
      { province: "Zambales", count: 22 },
    ],
    byStatus: [
      { status: "Operational", count: 170 },
      { status: "Non-Operational", count: 27 },
      { status: "Under Construction", count: 4 },
      { status: "Others", count: 2 },
    ],
    additionalMetrics: {
      byType: { "EMB Funded MRF": 84, "Funded Brgy MRF": 45, "LGU Funded MRF": 74 },
    },
  },
  {
    year: 2023,
    category: "lguMrf",
    totalRecords: 74,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2023,
    category: "trashTraps",
    totalRecords: 143,
    byProvince: [],
    byStatus: [
      { status: "Operational", count: 97 },
      { status: "Non-Operational", count: 26 },
      { status: "For Monitoring", count: 20 },
    ],
  },
  {
    year: 2023,
    category: "swmEquipment",
    totalRecords: 127,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2023,
    category: "residualContainment",
    totalRecords: 15,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2023,
    category: "transferStation",
    totalRecords: 45,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2023,
    category: "openDumpsite",
    totalRecords: 0,
    byProvince: [],
    byStatus: [],
  },

  // ───────────── 2024 ─────────────
  {
    year: 2024,
    category: "tenYearPlan",
    totalRecords: 137,
    byProvince: [
      { province: "Aurora", count: 9 },
      { province: "Bataan", count: 13 },
      { province: "Bulacan", count: 25 },
      { province: "Nueva Ecija", count: 33 },
      { province: "Pampanga", count: 23 },
      { province: "Tarlac", count: 19 },
      { province: "Zambales", count: 15 },
    ],
    byStatus: [
      { status: "Approved", count: 133 },
      { status: "Waiting for Approval", count: 1 },
      { status: "For Revision", count: 3 },
    ],
    additionalMetrics: {
      byPlanType: { "Municipal/City": 130, Provincial: 7 },
    },
  },
  {
    year: 2024,
    category: "slf",
    totalRecords: 32,
    byProvince: [
      { province: "Aurora", count: 7 },
      { province: "Bataan", count: 7 },
      { province: "Bulacan", count: 4 },
      { province: "Nueva Ecija", count: 5 },
      { province: "Pampanga", count: 3 },
      { province: "Tarlac", count: 1 },
      { province: "Zambales", count: 5 },
    ],
    byStatus: [
      { status: "Operational", count: 18 },
      { status: "Closed", count: 7 },
      { status: "Non Operational", count: 7 },
    ],
    additionalMetrics: {
      byCategory: { "Cat 1": 16, "Cat 2": 3, "Cat 4": 10 },
      byOwnership: { LGU: 27, Private: 5 },
    },
  },
  {
    year: 2024,
    category: "fundedMrf",
    totalRecords: 206,
    byProvince: [
      { province: "Aurora", count: 20 },
      { province: "Bataan", count: 27 },
      { province: "Bulacan", count: 48 },
      { province: "Nueva Ecija", count: 44 },
      { province: "Pampanga", count: 25 },
      { province: "Tarlac", count: 20 },
      { province: "Zambales", count: 22 },
    ],
    byStatus: [
      { status: "Operational", count: 176 },
      { status: "Non-Operational", count: 23 },
      { status: "Under Construction", count: 3 },
      { status: "Others", count: 4 },
    ],
    additionalMetrics: {
      byType: { "EMB Funded MRF": 84, "Funded Brgy MRF": 45, "LGU Funded MRF": 77 },
    },
  },
  {
    year: 2024,
    category: "lguMrf",
    totalRecords: 74,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2024,
    category: "trashTraps",
    totalRecords: 143,
    byProvince: [],
    byStatus: [
      { status: "Operational", count: 116 },
      { status: "Non-Operational", count: 27 },
    ],
  },
  {
    year: 2024,
    category: "swmEquipment",
    totalRecords: 131,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2024,
    category: "residualContainment",
    totalRecords: 15,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2024,
    category: "transferStation",
    totalRecords: 45,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2024,
    category: "openDumpsite",
    totalRecords: 0,
    byProvince: [],
    byStatus: [],
  },

  // ───────────── 2025 (baseline from eswm_universe.xlsx) ─────────────
  {
    year: 2025,
    category: "tenYearPlan",
    totalRecords: 126,
    byProvince: [
      { province: "Aurora", count: 9 },
      { province: "Bataan", count: 13 },
      { province: "Bulacan", count: 21 },
      { province: "Nueva Ecija", count: 28 },
      { province: "Pampanga", count: 22 },
      { province: "Tarlac", count: 19 },
      { province: "Zambales", count: 14 },
    ],
    byStatus: [],
  },
  {
    year: 2025,
    category: "slf",
    totalRecords: 19,
    byProvince: [],
    byStatus: [],
    additionalMetrics: {
      byCategory: { "Cat 1": 12, "Cat 2": 2, "Cat 4": 5 },
    },
  },
  {
    year: 2025,
    category: "fundedMrf",
    totalRecords: 113,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2025,
    category: "lguMrf",
    totalRecords: 80,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2025,
    category: "trashTraps",
    totalRecords: 143,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2025,
    category: "swmEquipment",
    totalRecords: 136,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2025,
    category: "residualContainment",
    totalRecords: 9,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2025,
    category: "transferStation",
    totalRecords: 18,
    byProvince: [],
    byStatus: [],
  },
  {
    year: 2025,
    category: "fundedRehab",
    totalRecords: 54,
    byProvince: [],
    byStatus: [],
  },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  // Upsert each record
  let upserted = 0;
  for (const h of HISTORY) {
    await DataHistory.findOneAndUpdate(
      { year: h.year, category: h.category },
      h,
      { upsert: true, new: true }
    );
    upserted++;
  }

  console.log(`Seeded ${upserted} data history records (2022–2025)`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
