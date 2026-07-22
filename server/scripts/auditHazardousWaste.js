/**
 * DEV-ONLY audit: Hazardous Waste submissions per SLF.
 *
 * Scans every non-deleted DataSLF submission and, using the SAME canonical
 * classifier the app uses (utils/wasteCategories#isHazardousWasteType), reports
 * per SLF:
 *   • Hazardous Waste submission count (a submission counts once if ANY truck/
 *     vehicle carries a hazardous load)
 *   • the raw stored wasteType variants that classified as hazardous
 *   • affected record IDs (idNo) — DEV console only, never exposed in the UI
 *   • the submission statuses present
 *
 * It also surfaces any raw wasteType value that does NOT map to a known canonical
 * category, so undocumented legacy variants can be caught.
 *
 * Usage:  node scripts/auditHazardousWaste.js
 *         node scripts/auditHazardousWaste.js --json   (machine-readable output)
 */
const mongoose = require("mongoose");
require("dotenv").config({ quiet: true });

const DataSLF = require("../models/DataSLF");
const {
  isHazardousWasteType,
  normalizeWasteType,
  WASTE_CATEGORY_ENUM,
} = require("../utils/wasteCategories");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const AS_JSON = process.argv.includes("--json");

function collectWasteTypes(doc) {
  const raws = [];
  (doc.trucks || []).forEach((t) => {
    const vehicles = (t.vehicles || []).filter((v) => Number(v?.actualVolume || 0) > 0);
    if (vehicles.length) vehicles.forEach((v) => raws.push(v?.wasteType ?? t?.wasteType));
    else raws.push(t?.wasteType);
  });
  return raws;
}

async function run() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });

  const cursor = DataSLF.find({ deletedAt: null })
    .setOptions({ includeHiddenYears: true })
    .select("idNo slfName lguCompanyName status isDummy trucks hazardousVolumeM3 hazardousVolumeTons")
    .lean()
    .cursor();

  const bySlf = new Map(); // slfName -> { count, variants:Set, ids:[], statuses:Set }
  const unknownVariants = new Map(); // rawValue -> count
  let totalHazSubs = 0;

  for (let doc = await cursor.next(); doc; doc = await cursor.next()) {
    if (doc.isDummy) continue;
    const raws = collectWasteTypes(doc);

    // Track any raw value that does not normalize to a known canonical enum.
    raws.forEach((r) => {
      const raw = String(r ?? "").trim();
      if (!raw) return;
      const norm = normalizeWasteType(raw);
      if (!WASTE_CATEGORY_ENUM.includes(norm)) {
        unknownVariants.set(raw, (unknownVariants.get(raw) || 0) + 1);
      }
    });

    const hazRaws = raws.filter((r) => isHazardousWasteType(r));
    if (!hazRaws.length) continue;

    totalHazSubs += 1;
    const slf = doc.slfName || doc.lguCompanyName || "Unassigned SLF";
    if (!bySlf.has(slf)) bySlf.set(slf, { count: 0, variants: new Set(), ids: [], statuses: new Set() });
    const rec = bySlf.get(slf);
    rec.count += 1;
    hazRaws.forEach((r) => rec.variants.add(String(r ?? "").trim() || "(empty)"));
    rec.ids.push(doc.idNo || String(doc._id));
    rec.statuses.add(doc.status || "(none)");
  }

  const rows = [...bySlf.entries()]
    .map(([slf, r]) => ({
      slf,
      hazardousSubmissions: r.count,
      variants: [...r.variants].sort(),
      statuses: [...r.statuses].sort(),
      recordIds: r.ids,
    }))
    .sort((a, b) => b.hazardousSubmissions - a.hazardousSubmissions);

  const summary = {
    totalHazardousSubmissions: totalHazSubs,
    slfCount: rows.length,
    unknownWasteTypeVariants: [...unknownVariants.entries()].map(([value, count]) => ({ value, count })),
  };

  if (AS_JSON) {
    console.log(JSON.stringify({ summary, rows }, null, 2));
  } else {
    console.log("\n=== Hazardous Waste Audit (per SLF) ===");
    console.log(`Total hazardous submissions: ${summary.totalHazardousSubmissions} across ${summary.slfCount} SLF(s)\n`);
    rows.forEach((r) => {
      console.log(`• ${r.slf}`);
      console.log(`    hazardous submissions : ${r.hazardousSubmissions}`);
      console.log(`    stored variants       : ${r.variants.join(", ")}`);
      console.log(`    statuses              : ${r.statuses.join(", ")}`);
      console.log(`    record ids (dev only) : ${r.recordIds.slice(0, 10).join(", ")}${r.recordIds.length > 10 ? ` … (+${r.recordIds.length - 10})` : ""}`);
    });
    console.log("\n=== Unknown / unmapped wasteType variants ===");
    if (!summary.unknownWasteTypeVariants.length) {
      console.log("None — every stored wasteType maps to a canonical category.");
    } else {
      summary.unknownWasteTypeVariants.forEach((u) => console.log(`  ${JSON.stringify(u.value)} → ${u.count} occurrence(s)`));
    }
    console.log("");
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
