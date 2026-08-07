/**
 * Backfill the company address PSGC codes that the Collapse-form bug dropped.
 *
 * Portal baseline edits used to call `companyForm.getFieldsValue()`, which
 * returns only CURRENTLY-MOUNTED fields. With the "Company Information" panel
 * collapsed, companyRegion/Province/Municipality were omitted from the payload
 * and wiped on save. That is fixed at the source (getFieldsValue(true)), but
 * records saved while the bug was live still have the fields missing.
 *
 * This restores them from each record's linked SlfFacility:
 *
 *   facility.province                    → companyProvince
 *   tail of facility.barangay            → companyMunicipality
 *   ("Pingit, Baler" → "Baler")            (SlfFacility has no municipality field)
 *
 * Codes are resolved through the SAME psgc.gitlab.io source the portal address
 * selects use (see routes/settings.js), so backfilled values are byte-identical
 * in format to what the form writes — storing readable names here instead would
 * leave two incompatible formats in one column.
 *
 *   node scripts/backfillCompanyAddress.js            dry run (default)
 *   node scripts/backfillCompanyAddress.js --apply    write changes
 *
 * Only fills fields that are EMPTY. It never overwrites an existing value, so
 * re-running is safe and a correct address can never be clobbered.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const REGION_III_CODE = "030000000";
const PSGC = "https://psgc.gitlab.io/api";

const apply = process.argv.includes("--apply");

// One fetch per URL for the whole run — the province/municipality lists are
// reused across every record, so this keeps the script to a handful of calls.
const cache = new Map();
async function psgc(url) {
  if (cache.has(url)) return cache.get(url);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`PSGC ${res.status} for ${url}`);
  const data = await res.json();
  cache.set(url, data);
  return data;
}

const norm = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\b(city of|municipality of|mun\.? of|city|municipality)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Municipality is stored as the tail of "Barangay, Municipality". */
function municipalityFromBarangay(barangay) {
  const text = String(barangay || "").trim();
  if (!text.includes(",")) return "";
  return text.split(",").pop().trim();
}

async function run() {
  const { connectMongo } = require("../config/mongo");
  const uri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    "mongodb://127.0.0.1:27017/embr3_eswmp";
  const dnsServers = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  await connectMongo(uri, { dnsServers });

  const DataSLF = require("../models/DataSLF");
  const SlfFacility = require("../models/SlfFacility");

  const blank = { $in: [null, ""] };
  const records = await DataSLF.find({
    deletedAt: null,
    $or: [{ companyProvince: blank }, { companyProvince: { $exists: false } }],
  })
    .select("slfGenerator slfName lguCompanyName companyRegion companyProvince companyMunicipality")
    .lean();

  console.log(`${records.length} record(s) missing a company province.`);
  if (!records.length) {
    await mongoose.disconnect();
    return;
  }

  const provinces = await psgc(`${PSGC}/regions/${REGION_III_CODE}/provinces/`);
  console.log(`Region III provinces loaded: ${provinces.length}`);

  let filled = 0;
  let skipped = 0;

  for (const record of records) {
    // Prefer the hard reference; fall back to the stored SLF name.
    const facility = record.slfGenerator
      ? await SlfFacility.findById(record.slfGenerator).select("province barangay lgu").lean()
      : await SlfFacility.findOne({ lgu: record.slfName || record.lguCompanyName })
          .select("province barangay lgu")
          .lean();

    if (!facility?.province) {
      console.log(`  skip ${record._id} — no facility/province`);
      skipped += 1;
      continue;
    }

    const province = provinces.find((p) => norm(p.name) === norm(facility.province));
    if (!province) {
      console.log(`  skip ${record._id} — province "${facility.province}" not in Region III`);
      skipped += 1;
      continue;
    }

    const update = {
      companyRegion: REGION_III_CODE,
      companyProvince: province.code,
    };

    const muniName = municipalityFromBarangay(facility.barangay);
    if (muniName) {
      const municipalities = await psgc(
        `${PSGC}/provinces/${province.code}/cities-municipalities/`,
      );
      const municipality = municipalities.find((m) => norm(m.name) === norm(muniName));
      if (municipality) update.companyMunicipality = municipality.code;
    }

    console.log(
      `  ${apply ? "fill" : "would fill"} ${record._id} → ${province.name}` +
        (update.companyMunicipality ? ` / ${muniName}` : " (municipality unresolved)"),
    );

    if (apply) {
      // Only set fields that are still empty — never overwrite real data.
      const $set = {};
      for (const [key, value] of Object.entries(update)) {
        if (!record[key]) $set[key] = value;
      }
      if (Object.keys($set).length) {
        await DataSLF.updateOne({ _id: record._id }, { $set });
      }
    }
    filled += 1;
  }

  console.log(
    `\n${apply ? "Applied" : "Dry run"}: ${filled} record(s) resolved, ${skipped} skipped.`,
  );
  if (!apply) console.log("Re-run with --apply to write these changes.");

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("Backfill failed:", err.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
