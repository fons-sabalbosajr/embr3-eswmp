// Copy the whole application database from one cluster to another.
//
// Written for the move off `erms-cluster` (a shared 512 MB tier that eight other
// apps filled to the quota, blocking every ESWMP write) onto the VERA cluster.
// The SOURCE is only ever read. The TARGET must be empty, or already hold an
// identical earlier copy (a collection whose count matches is skipped, so an
// interrupted run can simply be re-run).
//
// Copies, per collection: every index (with its options — unique, sparse, TTL,
// collation, partial filters) and every document, in batches. Then verifies
// document counts on both sides and prints one table.
//
// Usage (from server/):
//   node scripts/migrateDatabase.js --dry              # list what would be copied
//   node scripts/migrateDatabase.js                    # copy MONGODB_URI -> MONGODB_URI_VERA
//   node scripts/migrateDatabase.js --from=<uri> --to=<uri>
require("dotenv").config({ quiet: true });
const { MongoClient } = require("mongodb");

const args = process.argv.slice(2);
const flag = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || "").split("=").slice(1).join("=");
const DRY = args.includes("--dry");
const FROM = flag("from") || process.env.MONGODB_URI;
const TO = flag("to") || process.env.MONGODB_URI_VERA;
const BATCH = 500;
const SKIP = new Set(["_write_probe"]);

const dbNameOf = (uri) => (String(uri).match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/) || [])[1] || "";
const hostOf = (uri) => String(uri).replace(/^.*@/, "").replace(/\/.*$/, "");

async function run() {
  if (!FROM || !TO) throw new Error("Both a source (MONGODB_URI / --from) and a target (MONGODB_URI_VERA / --to) are required.");
  if (hostOf(FROM) === hostOf(TO)) throw new Error("Source and target are the same cluster — refusing.");

  const src = new MongoClient(FROM, { serverSelectionTimeoutMS: 15000 });
  const dst = new MongoClient(TO, { serverSelectionTimeoutMS: 15000 });
  await src.connect();
  await dst.connect();
  const sdb = src.db(dbNameOf(FROM) || undefined);
  const ddb = dst.db(dbNameOf(TO) || sdb.databaseName);
  console.log(`[migrate] ${DRY ? "DRY RUN — " : ""}${hostOf(FROM)}/${sdb.databaseName}  ->  ${hostOf(TO)}/${ddb.databaseName}`);

  const collections = (await sdb.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system.") && !SKIP.has(n))
    .sort();

  const rows = [];
  for (const name of collections) {
    const s = sdb.collection(name);
    const d = ddb.collection(name);
    const srcCount = await s.countDocuments();
    const dstBefore = await d.countDocuments();
    const indexes = (await s.indexes()).filter((ix) => ix.name !== "_id_");

    if (dstBefore > 0 && dstBefore !== srcCount) {
      throw new Error(`Target collection "${name}" already has ${dstBefore} docs (source ${srcCount}) — not empty and not an identical copy. Aborting before writing anything more.`);
    }
    if (DRY) {
      rows.push({ name, srcCount, dstCount: dstBefore, indexes: indexes.length, status: dstBefore === srcCount && srcCount > 0 ? "already copied" : "would copy" });
      continue;
    }

    // Indexes first, so a unique index rejects a duplicate rather than a
    // later build failing on one.
    for (const ix of indexes) {
      const { key, name: ixName, v, ns, background, ...options } = ix;
      await d.createIndex(key, { name: ixName, ...options });
    }

    let copied = 0;
    if (dstBefore === srcCount && srcCount > 0) {
      rows.push({ name, srcCount, dstCount: dstBefore, indexes: indexes.length, status: "already copied (skipped)" });
      continue;
    }
    const cursor = s.find({}, { batchSize: BATCH });
    let batch = [];
    for await (const doc of cursor) {
      batch.push(doc);
      if (batch.length >= BATCH) {
        copied += (await d.insertMany(batch, { ordered: false })).insertedCount;
        batch = [];
      }
    }
    if (batch.length) copied += (await d.insertMany(batch, { ordered: false })).insertedCount;

    const dstAfter = await d.countDocuments();
    rows.push({ name, srcCount, dstCount: dstAfter, indexes: indexes.length, status: dstAfter === srcCount ? "OK" : "COUNT MISMATCH" });
    process.stdout.write(`  ${name}: ${copied} docs, ${indexes.length} indexes${dstAfter === srcCount ? "" : "  <-- MISMATCH"}\n`);
  }

  console.log("\n" + "collection".padEnd(34) + "source".padStart(8) + "target".padStart(8) + "  idx  status");
  rows.forEach((r) => console.log(r.name.padEnd(34) + String(r.srcCount).padStart(8) + String(r.dstCount).padStart(8) + String(r.indexes).padStart(5) + "  " + r.status));
  const bad = rows.filter((r) => r.status === "COUNT MISMATCH");
  console.log(`\n[migrate] ${rows.length} collections; ${bad.length} mismatches.`);
  await src.close();
  await dst.close();
  if (bad.length) process.exit(2);
}

run().catch((e) => { console.error("[migrate] FAILED:", e.message); process.exit(1); });
