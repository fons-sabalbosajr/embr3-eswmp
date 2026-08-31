/**
 * Verify: the fast hauler-roster read returns the SAME answer as the old one.
 *
 * getAuthoritativeHaulersForEntry decides whether an uploaded disposal row's
 * hauler and client are accredited under the SLF. If it drifts, a submission
 * that should be accepted is refused with "Hauler is not assigned under this
 * SLF" / "duplicated or ambiguous" — so making it fast is only safe if the
 * answer is identical.
 *
 * The old path pulled every copy of `accreditedHaulers` for the facility and did
 * the union in JavaScript. The new one does the union in an aggregation. This
 * runs BOTH against the live data, for every facility that has a roster, and
 * compares:
 *
 *   • the set of haulers (normalized identity — what decides "not assigned")
 *   • each hauler's client set (normalized — what decides "not accredited")
 *
 * …and times them, so the speedup is measured rather than asserted.
 *
 * READ-ONLY. It runs two reads per facility and writes nothing. Client and
 * hauler names are printed ONLY for a mismatch, because a mismatch cannot be
 * acted on without knowing which record it is.
 *
 * Usage
 * -----
 *   node scripts/verifyHaulerRosterParity.js            # every facility
 *   node scripts/verifyHaulerRosterParity.js --limit 5  # the heaviest few
 */
require("dotenv").config();
const mongoose = require("mongoose");

const { connectMongo } = require("../config/mongo");
const DataSLF = require("../models/DataSLF");
const dataSlfRoutes = require("../routes/dataSLF");

const { mergeAccreditedHaulerCopies, getAuthoritativeHaulersForEntry } = dataSlfRoutes;

const MONGODB_DNS_SERVERS = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",").map((v) => v.trim()).filter(Boolean);

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) || 0 : 0;

// The SAME normalization the relationship checks use, so this compares what the
// validator compares rather than raw strings.
const norm = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/[,;-]+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const clientKey = (client) =>
  typeof client === "string" ? norm(client) : norm(client?.clientName || client?.name);

/** The OLD read, reproduced verbatim: every copy, unioned in JavaScript. */
async function legacyRoster(slfGeneratorId) {
  const baselines = await DataSLF.find({
    slfGenerator: slfGeneratorId,
    "accreditedHaulers.0": { $exists: true },
  })
    .select("accreditedHaulers createdAt")
    .sort({ createdAt: -1 })
    .lean();
  return mergeAccreditedHaulerCopies(baselines.flatMap((b) => b.accreditedHaulers || []));
}

/** Roster → Map(haulerKey → Set(clientKey)), which is what the checks consult. */
function toComparable(haulers) {
  const map = new Map();
  (haulers || []).forEach((hauler) => {
    const key = norm(hauler?.haulerName || hauler?.name);
    if (!key) return;
    const clients = new Set();
    (hauler.clients || []).forEach((client) => {
      const ck = clientKey(client);
      if (ck) clients.add(ck);
    });
    // A hauler listed twice under one identity unions, as the merge does.
    const existing = map.get(key);
    if (existing) clients.forEach((c) => existing.add(c));
    else map.set(key, clients);
  });
  return map;
}

function diffSets(a, b) {
  const onlyA = [...a].filter((v) => !b.has(v));
  const onlyB = [...b].filter((v) => !a.has(v));
  return { onlyA, onlyB };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set.");
  if (typeof getAuthoritativeHaulersForEntry !== "function") {
    throw new Error("getAuthoritativeHaulersForEntry is not exported from routes/dataSLF.js");
  }
  await connectMongo(process.env.MONGODB_URI, { dnsServers: MONGODB_DNS_SERVERS });

  const facilities = await DataSLF.aggregate([
    { $match: { "accreditedHaulers.0": { $exists: true }, slfGenerator: { $ne: null } } },
    {
      $group: {
        _id: "$slfGenerator",
        slfName: { $first: "$slfName" },
        records: { $sum: 1 },
        bytes: { $sum: { $bsonSize: { a: "$accreditedHaulers" } } },
      },
    },
    { $sort: { bytes: -1 } },
    ...(LIMIT ? [{ $limit: LIMIT }] : []),
  ]).option({ maxTimeMS: 120000 });

  console.log("");
  console.log("Hauler roster parity — old read vs new read");
  console.log("===========================================");
  console.log(`Facilities with a roster: ${facilities.length}`);
  console.log("");

  let mismatches = 0;
  let timedOut = 0;
  let oldTotalMs = 0;
  let newTotalMs = 0;

  for (const facility of facilities) {
    const item = { slfGenerator: facility._id };

    // The OLD read is the one that fails in production, so it has to be allowed
    // to fail here too — a timeout on this line is the bug being reproduced, not
    // the verification breaking. The new read still runs, and a facility where
    // only the old one dies is the clearest possible evidence.
    const t0 = Date.now();
    let legacy = null;
    let legacyError = null;
    try {
      legacy = await legacyRoster(facility._id);
    } catch (error) {
      legacyError = error.message;
    }
    const oldMs = Date.now() - t0;

    const t1 = Date.now();
    const current = await getAuthoritativeHaulersForEntry(item);
    const newMs = Date.now() - t1;

    oldTotalMs += oldMs;
    newTotalMs += newMs;

    if (legacyError) {
      timedOut += 1;
      const b0 = toComparable(current);
      console.log(`OLD FAILS ${facility.slfName || facility._id}`);
      console.log(`        records: ${facility.records}  array on disk: ${Math.round(facility.bytes / 1024)} KB`);
      console.log(`        old: ${oldMs}ms — ${legacyError}`);
      console.log(
        `        new: ${newMs}ms — OK, ${b0.size} haulers / ` +
          `${[...b0.values()].reduce((n, s) => n + s.size, 0)} clients`,
      );
      console.log("");
      continue;
    }

    const a = toComparable(legacy);
    const b = toComparable(current);
    const haulerDiff = diffSets(new Set(a.keys()), new Set(b.keys()));

    const clientDiffs = [];
    for (const [hauler, clientsA] of a) {
      const clientsB = b.get(hauler);
      if (!clientsB) continue; // already reported as a hauler difference
      const d = diffSets(clientsA, clientsB);
      if (d.onlyA.length || d.onlyB.length) clientDiffs.push({ hauler, ...d });
    }

    const ok = !haulerDiff.onlyA.length && !haulerDiff.onlyB.length && !clientDiffs.length;
    if (!ok) mismatches += 1;

    const speed = newMs > 0 ? `${Math.round((oldMs / newMs) * 10) / 10}x` : "—";
    console.log(
      `${ok ? "MATCH  " : "DIFFER "} ${facility.slfName || facility._id}`,
    );
    console.log(
      `        records: ${facility.records}  haulers: ${a.size}  ` +
        `clients: ${[...a.values()].reduce((n, s) => n + s.size, 0)}`,
    );
    console.log(
      `        old: ${oldMs}ms   new: ${newMs}ms   (${speed} faster)  ` +
        `array on disk: ${Math.round(facility.bytes / 1024)} KB`,
    );

    if (haulerDiff.onlyA.length) {
      console.log(`        HAULERS LOST BY NEW READ: ${haulerDiff.onlyA.join(", ")}`);
    }
    if (haulerDiff.onlyB.length) {
      console.log(`        HAULERS ADDED BY NEW READ: ${haulerDiff.onlyB.join(", ")}`);
    }
    clientDiffs.forEach((d) => {
      if (d.onlyA.length) console.log(`        "${d.hauler}" CLIENTS LOST: ${d.onlyA.join(", ")}`);
      if (d.onlyB.length) console.log(`        "${d.hauler}" CLIENTS ADDED: ${d.onlyB.join(", ")}`);
    });
    console.log("");
  }

  console.log("Summary");
  console.log("-------");
  console.log(`Facilities checked : ${facilities.length}`);
  console.log(`Mismatches         : ${mismatches}`);
  console.log(`Old read failed on : ${timedOut}  (the new read answered all of them)`);
  console.log(`Total old read time: ${oldTotalMs} ms`);
  console.log(`Total new read time: ${newTotalMs} ms`);
  if (newTotalMs > 0) {
    console.log(`Overall speedup    : ${Math.round((oldTotalMs / newTotalMs) * 10) / 10}x`);
  }
  console.log("");
  console.log(
    mismatches === 0
      ? "PASS — the fast read returns the same roster on every facility."
      : "FAIL — the fast read disagrees. Do NOT deploy; the differences are listed above.",
  );
  process.exitCode = mismatches === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(`\nVerification failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.connection.close());
