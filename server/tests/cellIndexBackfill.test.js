/**
 * The cellIndex backfill script's SAFETY contract, and the Mini Dashboard cache.
 *
 * The backfill writes to production data, so what matters is not that it can
 * resolve rows — baselineCellIdentity.test.js already pins the resolver — but
 * that it cannot do anything else: no guessing, no overwriting a valid index, no
 * writes in dry-run, and the same answer on a second run.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { resolveBaselineCellEntries } = require("../utils/cellNaming");
const serverCache = require("../utils/serverCache");
const cacheKeys = require("../utils/cacheKeys");
const { refreshAdmin, refreshPortal } = require("../utils/socketEmit");

const SCRIPT = path.join(__dirname, "..", "scripts", "backfillBaselineCellIndex.js");
const source = fs.readFileSync(SCRIPT, "utf8");

// Live shapes: Limay declares ONE cell but stores a "Cell 3" row; Olongapo's
// closed row is "CELL IA" against cells "Cell 1B" and an unnamed second.
const LIMAY = { numberOfCell: 1, cellNames: [""], cellTypes: ["Residual"], cellStatuses: ["Active Cell"] };
const OLONGAPO = { numberOfCell: 2, cellNames: ["Cell 1B", ""], cellTypes: ["Residual", "Residual"] };
const BESLF = {
  numberOfCell: 3,
  cellNames: ["Cell Area Phase 1", "Cell Area Phase 2", "Cell Area Phase 3"],
  cellTypes: ["Residual", "Residual", "Residual"],
};

// ── Dry-run / write safety ──────────────────────────────────────────────────

test("the script is DRY-RUN unless --apply is passed", () => {
  assert.match(source, /const APPLY = process\.argv\.includes\("--apply"\)/);
  assert.match(source, /if \(!APPLY\) \{/, "there must be an early return before any write");
  // The only write in the file must sit AFTER that guard.
  const guard = source.indexOf("if (!APPLY) {");
  const write = source.indexOf("DataSLF.updateOne");
  assert.ok(guard > -1 && write > guard, "no write may be reachable in dry-run");
});

test("the script writes ONLY the two cell-entry arrays", () => {
  const writes = source.match(/DataSLF\.(updateOne|updateMany|deleteOne|deleteMany|insertMany|create)/g) || [];
  assert.deepEqual(writes, ["DataSLF.updateOne"], "one write call, and it must not delete or insert");
  const block = source.slice(source.indexOf("let updated = 0;"), source.indexOf("console.log(`\\nUpdated"));
  assert.match(block, /\$set: set/);
  assert.doesNotMatch(block, /\$unset|deleteOne|remove\(/, "the backfill must never remove anything");
  assert.match(source, /for \(const field of \["activeCellEntries", "closedCellEntries"\]\)/);
});

test("timestamps are preserved, so a backfill does not look like an operator edit", () => {
  assert.match(source, /timestamps: false/);
});

test("the script reuses the application's resolver rather than its own rule", () => {
  assert.match(
    source,
    /require\("\.\.\/utils\/cellNaming"\)/,
    "a second copy of the mapping rule could disagree with what the portal shows",
  );
  assert.match(source, /resolveBaselineCellEntries/);
});

// ── Resolution behaviour the script depends on ──────────────────────────────

test("a row that already has a valid index is left exactly as it was", () => {
  const row = { cellIndex: 1, cellName: "Cell Area Phase 2", cellType: "Residual", volume: 12 };
  const [out] = resolveBaselineCellEntries([row], BESLF);
  assert.equal(out, row, "unchanged rows keep object identity — nothing to write");
  assert.equal(out.cellIndex, 1);
});

test("an ambiguous row is never bound, so the backfill has nothing to write for it", () => {
  const [limay] = resolveBaselineCellEntries([{ cellName: "Cell 3", volume: 63091.09 }], LIMAY);
  assert.equal(limay.cellIndex, null, "the facility declares one cell; 'Cell 3' cannot be resolved");
  assert.equal(limay.volume, 63091.09, "the operator's figure is preserved");

  const [olongapo] = resolveBaselineCellEntries([{ cellName: "CELL IA", volume: 96000 }], OLONGAPO);
  assert.equal(olongapo.cellIndex, null);
  assert.equal(olongapo.cellName, "CELL IA", "the stored label stays, so an admin can still identify it");

  const [tinio] = resolveBaselineCellEntries([{ cellName: "GENERAL TINIO SANITARY LANDFILL", volume: 9 }], BESLF);
  assert.equal(tinio.cellIndex, null);
});

test("the backfill is IDEMPOTENT — resolving twice gives the same answer", () => {
  const stored = [
    { cellName: "Cell 1", volume: 10 },
    { cellName: "CELL IA", volume: 20 },
    { cellIndex: 2, cellName: "Cell Area Phase 3", cellType: "Residual", volume: 30 },
  ];
  const first = resolveBaselineCellEntries(stored, BESLF);
  const second = resolveBaselineCellEntries(first, BESLF);
  assert.deepEqual(second, first, "a second run must find nothing to change");
  // And the second pass changes no object at all.
  second.forEach((row, i) => assert.equal(row, first[i], "row identity is stable on re-run"));
});

test("resolution never reaches outside the facility's own cells", () => {
  const [row] = resolveBaselineCellEntries([{ cellName: "Cell 9", volume: 1 }], BESLF);
  assert.equal(row.cellIndex, null, "a positional label past the cell count is not a cell");
});

// ── Mini Dashboard cache ────────────────────────────────────────────────────

test("the waste-received summary is cached per facility, per year — never globally", () => {
  const routeSource = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
  assert.match(
    routeSource,
    /router\.get\("\/waste-received-summary\/:slfName", cacheJson\(wasteReceivedCacheKey, 120000\)/,
  );
  // Every parameter that changes the answer must be in the key.
  const keyFn = routeSource.slice(
    routeSource.indexOf("const wasteReceivedCacheKey"),
    routeSource.indexOf("router.get(\"/waste-received-summary"),
  );
  assert.match(keyFn, /req\.query\.slfId/);
  assert.match(keyFn, /req\.params\.slfName/);
  assert.match(keyFn, /req\.query\.year/);
});

test("different facilities cannot collide on the same cache key", async () => {
  const { cacheJson } = require("../middleware/cacheRoute");
  serverCache._clearLocal();
  const key = (req) => `${cacheKeys.WASTE_RECEIVED_PREFIX}:${req.query.slfId || "-"}:${req.params.slfName}:${req.query.year || "all"}`;
  const a = key({ params: { slfName: "Santa Rosa" }, query: { slfId: "aaa" } });
  const b = key({ params: { slfName: "Guimba" }, query: { slfId: "bbb" } });
  const c = key({ params: { slfName: "Santa Rosa" }, query: { slfId: "aaa", year: "2025" } });
  assert.notEqual(a, b);
  assert.notEqual(a, c, "a year filter must not read the unfiltered entry");
  assert.ok(typeof cacheJson === "function");

  await serverCache.set(a, { totals: { m3: 1 } }, 60000);
  assert.equal(await serverCache.get(b), undefined, "one SLF's summary must never answer another's request");
});

test("a submission or baseline write clears the Mini Dashboard cache", async () => {
  const req = { app: { get: () => null } };
  for (const target of ["submissions", "baselines", "facility"]) {
    serverCache._clearLocal();
    const key = `${cacheKeys.WASTE_RECEIVED_PREFIX}:abc:Santa Rosa:all`;
    await serverCache.set(key, { totals: { m3: 7884 } }, 120000);
    refreshAdmin(req, target);
    await new Promise((r) => setImmediate(r));
    assert.equal(await serverCache.get(key), undefined, `${target} must not leave a stale Submitted Vol.`);
  }
});

test("a portal-only refresh clears it too — the portal is what reads this", async () => {
  // Admin baseline approve/reject/lock notifies ONLY the portal.
  serverCache._clearLocal();
  const key = `${cacheKeys.WASTE_RECEIVED_PREFIX}:abc:Santa Rosa:all`;
  await serverCache.set(key, { totals: { m3: 7884 } }, 120000);
  refreshPortal({ app: { get: () => null } }, "operator@example.com", "baselines");
  await new Promise((r) => setImmediate(r));
  assert.equal(await serverCache.get(key), undefined);
});

test("an unrelated refresh target leaves the cache alone", async () => {
  serverCache._clearLocal();
  const key = `${cacheKeys.WASTE_RECEIVED_PREFIX}:abc:Santa Rosa:all`;
  await serverCache.set(key, { totals: { m3: 7884 } }, 120000);
  refreshAdmin({ app: { get: () => null } }, "hauler-requests");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await serverCache.get(key), { totals: { m3: 7884 } });
});
