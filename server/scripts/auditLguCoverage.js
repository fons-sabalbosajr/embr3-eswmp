/**
 * Audit: why is "LGUs Served" lower than expected?
 *
 * Coverage is `distinct masterlist municipalities among LGU clients that have a
 * hauler` ÷ `Active Region 3 municipalities + cities`. A client only counts if it
 * resolves to a masterlist row, so the two things that quietly suppress the
 * figure are:
 *
 *   • a client whose municipality cannot be matched (blank or misspelled
 *     `municipalityCity`, or an LGU outside Region 3)
 *   • several clients collapsing onto the SAME municipality — correct by design
 *     (one LGU served by several haulers counts once), but worth seeing
 *
 * READ-ONLY. This changes nothing; it prints the records to correct at source.
 *
 * Usage
 * -----
 *   node scripts/auditLguCoverage.js            # summary + unmatched list
 *   node scripts/auditLguCoverage.js --full     # also list every served LGU
 */
require("dotenv").config();
const mongoose = require("mongoose");

const { connectMongo } = require("../config/mongo");
const SlfClient = require("../models/SlfClient");
const Region3Lgu = require("../models/Region3Lgu");

const FULL = process.argv.includes("--full");
const MUNI_TYPES = ["Municipality", "City"];
const MONGODB_DNS_SERVERS = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",").map((v) => v.trim()).filter(Boolean);

const norm = (value) =>
  String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set.");
  await connectMongo(process.env.MONGODB_URI, { dnsServers: MONGODB_DNS_SERVERS });

  const masterMunis = await Region3Lgu.find({ status: "Active", lguType: { $in: MUNI_TYPES } })
    .select("_id name municipalityCity province lguType").lean();

  // Name → masterlist id. Blank names are skipped so a client with no
  // municipality can never "match" an empty masterlist entry.
  const masterByName = new Map();
  masterMunis.forEach((m) => {
    [m.name, m.municipalityCity].filter(Boolean).forEach((n) => {
      const key = norm(n);
      if (key) masterByName.set(key, m);
    });
  });

  const clients = await SlfClient.find({
    deletedAt: null, isCanonical: true, mergedInto: null,
    status: "Active", isDummy: { $ne: true }, type: "LGU",
  })
    .select("name municipalityCity province address hauler haulerRelationships")
    .lean();

  const servedBy = new Map(); // masterlist id -> client names
  const unmatched = [];
  const noHauler = [];

  clients.forEach((c) => {
    const haulers = [...(c.haulerRelationships || []).map((h) => h.hauler), c.hauler].filter(Boolean);
    const master =
      masterByName.get(norm(c.municipalityCity)) || masterByName.get(norm(c.name)) || null;

    if (!master) {
      unmatched.push({
        name: c.name,
        municipalityCity: c.municipalityCity || "(blank)",
        province: c.province || "(blank)",
      });
      return;
    }
    if (!haulers.length) {
      noHauler.push({ name: c.name, municipality: master.name });
      return;
    }
    const key = String(master._id);
    if (!servedBy.has(key)) servedBy.set(key, { municipality: master.name, province: master.province, clients: [] });
    servedBy.get(key).clients.push(c.name);
  });

  const served = servedBy.size;
  const total = masterMunis.length;
  console.log("── LGU coverage ──────────────────────────────────────────────");
  console.log(`  masterlist (Active Municipality + City) : ${total}`);
  console.log(`  LGU client records                      : ${clients.length}`);
  console.log(`  → SERVED                                : ${served} / ${total} (${total ? Math.round((served / total) * 1000) / 10 : 0}%)`);
  console.log(`  unmatched to masterlist                 : ${unmatched.length}`);
  console.log(`  matched but with no hauler              : ${noHauler.length}`);

  if (unmatched.length) {
    console.log("\n── Not counted: no masterlist match ──────────────────────────");
    console.log("   Fix `municipalityCity` on these, or confirm they are outside Region 3.\n");
    unmatched
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((u) => console.log(`   ${u.name}\n       municipalityCity="${u.municipalityCity}"  province="${u.province}"`));
  }

  if (noHauler.length) {
    console.log("\n── Not counted: no hauler assigned ───────────────────────────");
    noHauler.forEach((n) => console.log(`   ${n.name}  → ${n.municipality}`));
  }

  // Several clients on one municipality is CORRECT (it counts once) — shown so a
  // low coverage figure can be understood rather than doubted.
  const collapsed = [...servedBy.values()].filter((g) => g.clients.length > 1);
  if (collapsed.length) {
    console.log(`\n── Municipalities served by more than one client (counted once) ──`);
    collapsed
      .sort((a, b) => b.clients.length - a.clients.length)
      .slice(0, FULL ? collapsed.length : 10)
      .forEach((g) => console.log(`   ${g.municipality} (${g.province}) ← ${g.clients.length} client records`));
    if (!FULL && collapsed.length > 10) console.log(`   …and ${collapsed.length - 10} more (--full to list all)`);
  }

  if (FULL) {
    console.log("\n── Served municipalities ─────────────────────────────────────");
    [...servedBy.values()]
      .sort((a, b) => String(a.province).localeCompare(String(b.province)) || a.municipality.localeCompare(b.municipality))
      .forEach((g) => console.log(`   ${String(g.province).padEnd(14)} ${g.municipality}`));
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Failed:", error.message);
  try { await mongoose.disconnect(); } catch { /* already closed */ }
  process.exit(1);
});
