/**
 * Seed script: Populate data_references collection from Excel Data Validation sheet
 *
 * Usage:  node seeds/seedDataReferences.js
 */
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");
require("dotenv").config();

const DataReference = require("../models/DataReference");

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const EXCEL_PATH = path.resolve(
  __dirname,
  "../../front-end/docs/eswm_universe.xlsx",
);
const SHEET_NAME = "Data Validation";

/** Read a column's non-empty values from rowStart..rowEnd (0-based) */
function colValues(data, col, rowStart, rowEnd) {
  const vals = [];
  for (let r = rowStart; r <= Math.min(rowEnd, data.length - 1); r++) {
    const v = data[r] && data[r][col] != null ? String(data[r][col]).trim() : "";
    if (v) vals.push(v);
  }
  return vals;
}

async function seed() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB");

  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) {
    console.error(`Sheet "${SHEET_NAME}" not found`);
    process.exit(1);
  }
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  // ── Extract reference categories from the Excel layout ──

  const refs = [
    // General
    {
      category: "province",
      label: "Province",
      module: "General",
      description: "List of provinces in Region 3",
      values: [
        "Aurora",
        "Bataan",
        "Bulacan",
        "Nueva Ecija",
        "Pampanga",
        "Tarlac",
        "Zambales",
      ],
    },
    {
      category: "manila-bay-area",
      label: "Manila Bay Area",
      module: "General",
      description: "Manila Bay Area classification",
      values: ["MBA", "OUTSIDE MBA"],
    },
    {
      category: "yes-no",
      label: "Yes / No",
      module: "General",
      description: "General yes/no options",
      values: colValues(data, 1, 1, 5).filter(
        (v, i, a) => a.indexOf(v) === i,
      ),
    },
    {
      category: "target-month",
      label: "Target Month",
      module: "General",
      description: "Target month for monitoring activities",
      values: colValues(data, 0, 12, 23),
    },
    {
      category: "type-of-plan",
      label: "Type of Plan",
      module: "General",
      description: "SWM plan types",
      values: colValues(data, 0, 1, 2),
    },

    // Personnel
    {
      category: "enmo",
      label: "List of ENMO",
      module: "Personnel",
      description: "Environmental Management Officers",
      values: colValues(data, 2, 13, 35),
    },
    {
      category: "eswm-staff",
      label: "ESWM Staff",
      module: "Personnel",
      description: "ESWM staff members",
      values: colValues(data, 3, 13, 35),
    },
    {
      category: "eswm-focal",
      label: "ESWM Focal",
      module: "Personnel",
      description: "ESWM focal persons",
      values: colValues(data, 4, 13, 35),
    },

    // MRF
    {
      category: "type-of-mrf",
      label: "Type of MRF",
      module: "MRF",
      description: "Material Recovery Facility types",
      values: colValues(data, 0, 7, 9),
    },
    {
      category: "mrf-status",
      label: "MRF Status",
      module: "MRF",
      description: "Status options for MRF facilities",
      values: colValues(data, 7, 1, 5),
    },
    {
      category: "lgu-mrf-type",
      label: "LGU MRF Type",
      module: "MRF",
      description: "LGU-initiated MRF types",
      values: ["LGU MRF", "BRGY MRF"],
    },

    // SLF
    {
      category: "slf-status",
      label: "SLF Status",
      module: "SLF",
      description: "Status options for Sanitary Landfill facilities",
      values: colValues(data, 7, 1, 5), // same statuses as MRF column
    },
    {
      category: "ownership",
      label: "Ownership",
      module: "SLF",
      description: "Facility ownership types",
      values: colValues(data, 24, 1, 5),
    },
    {
      category: "unit",
      label: "Unit",
      module: "SLF",
      description: "Measurement units (capacity, waste)",
      values: ["tons", "m³"],
    },
    {
      category: "waste-type",
      label: "Waste Type",
      module: "SLF",
      description: "Types of waste received",
      values: ["Residual", "Hazardous Waste"],
    },

    // Equipment
    {
      category: "equipment-status",
      label: "Equipment Status",
      module: "Equipment",
      description: "Status options for SWM equipment",
      values: colValues(data, 10, 1, 5),
    },

    // Trash Trap
    {
      category: "trash-trap-status",
      label: "Trash Trap Status",
      module: "Trash Trap",
      description: "Status options for trash traps",
      values: colValues(data, 19, 1, 5),
    },

    // 10-Year SWM Plan
    {
      category: "swm-plan-status",
      label: "SWM Plan Status",
      module: "10-Year Plan",
      description: "Approval status of SWM plans",
      values: ["Approved", "For Renewal", "Pending"],
    },
    {
      category: "swm-plan-compliance",
      label: "SWM Plan Compliance",
      module: "10-Year Plan",
      description: "Compliance status of SWM plans",
      values: ["Compliant", "Non-Compliant"],
    },

    // ODS (future)
    {
      category: "ods-rehab-status",
      label: "ODS Rehabilitation Status",
      module: "Open Dump Sites",
      description: "Rehabilitation status for open dump sites",
      values: colValues(data, 12, 1, 5),
    },
    {
      category: "ods-compliance",
      label: "ODS Compliance",
      module: "Open Dump Sites",
      description: "Compliance status for open dump sites",
      values: colValues(data, 13, 1, 5),
    },

    // PDS (future)
    {
      category: "pds-status",
      label: "PDS Status",
      module: "PDS",
      description: "Status options for PDS Scoping",
      values: colValues(data, 16, 1, 5),
    },

    // Transfer Station (future)
    {
      category: "transfer-station-status",
      label: "Transfer Station Status",
      module: "Transfer Station",
      description: "Status options for transfer stations",
      values: colValues(data, 22, 1, 5),
    },
    {
      category: "transfer-station-type",
      label: "Transfer Station Type",
      module: "Transfer Station",
      description: "Type of transfer station facility",
      values: colValues(data, 23, 1, 5),
    },

    // RCA (future)
    {
      category: "rca-status",
      label: "RCA Status",
      module: "RCA",
      description: "Status options for Residual Containment Areas",
      values: colValues(data, 29, 1, 5),
    },
    {
      category: "rca-type",
      label: "RCA Type",
      module: "RCA",
      description: "Type of RCA facility",
      values: colValues(data, 30, 1, 5),
    },
  ];

  // Upsert each reference
  let created = 0;
  let updated = 0;
  for (const ref of refs) {
    const existing = await DataReference.findOne({ category: ref.category });
    if (existing) {
      existing.label = ref.label;
      existing.module = ref.module;
      existing.description = ref.description;
      existing.values = ref.values;
      await existing.save();
      updated++;
    } else {
      await DataReference.create(ref);
      created++;
    }
    console.log(
      `  ${existing ? "Updated" : "Created"}: ${ref.label} (${ref.values.length} values)`,
    );
  }

  console.log(`\nDone — ${created} created, ${updated} updated`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
