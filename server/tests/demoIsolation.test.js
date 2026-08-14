/**
 * Demo/dummy isolation — masking and write isolation.
 *
 * The two flags are deliberately different jobs (see utils/demoMode.js):
 *   isDemo  marks an ACCOUNT  → masked session + write guard
 *   isDummy marks a RECORD    → excluded from every production query
 *
 * These tests pin the rule that decides whether a value the demo session
 * receives is masked, because masking the demo account's OWN data is what made
 * its Total Volume Accepted arrive as "***********" and blocked its submission.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MASK,
  maskConfidentialValues,
  decideDemoWrite,
} = require("../utils/demoMode");

// ── T12 — the `*` display value ─────────────────────────────────────────────
test("T12 a PRODUCTION record's confidential figures are still masked", () => {
  const masked = maskConfidentialValues({
    slfName: "Real SLF",
    totalVolumeAccepted: 1500,
    cellCapacities: [90000, 110000],
    numberOfCell: 2,
  });
  assert.equal(masked.totalVolumeAccepted, MASK);
  assert.deepEqual(masked.cellCapacities, [MASK, MASK]);
  assert.equal(masked.numberOfCell, 2, "non-confidential fields are untouched");
  assert.equal(masked.slfName, "Real SLF");
});

test("T12 a DEMO-OWNED record keeps its real figures readable", () => {
  const masked = maskConfidentialValues({
    slfName: "Demonstration Valley",
    isDummy: true,
    totalVolumeAccepted: 1500,
    cellCapacities: [90000, 110000],
  });
  assert.equal(masked.totalVolumeAccepted, 1500, "the demo account's own baseline must be usable");
  assert.deepEqual(masked.cellCapacities, [90000, 110000]);
});

test("T12 demo ownership propagates into nested documents", () => {
  const masked = maskConfidentialValues({
    isDummy: true,
    slfGenerator: { lgu: "Demonstration Valley", cellCapacities: [90000] },
    trucks: [{ plateNumber: "TST-0001", volume: 12.5 }],
  });
  assert.deepEqual(masked.slfGenerator.cellCapacities, [90000]);
  assert.equal(masked.trucks[0].volume, 12.5);
});

test("T12 a mixed list masks only the production rows", () => {
  const masked = maskConfidentialValues([
    { slfName: "Real SLF", totalVolumeAccepted: 900 },
    { slfName: "Demonstration Valley", isDummy: true, totalVolumeAccepted: 1500 },
  ]);
  assert.equal(masked[0].totalVolumeAccepted, MASK);
  assert.equal(masked[1].totalVolumeAccepted, 1500);
});

test("T12 masking never turns a real number into a value the validator accepts", () => {
  // The blockage rule (front-end submitBlockers / server hasPositiveRequiredNumber)
  // is Number(value) > 0. A masked value must fail it; a demo-owned value must pass.
  const production = maskConfidentialValues({ totalVolumeAccepted: 1500 });
  const demo = maskConfidentialValues({ isDummy: true, totalVolumeAccepted: 1500 });
  assert.equal(Number(production.totalVolumeAccepted) > 0, false);
  assert.equal(Number(demo.totalVolumeAccepted) > 0, true);
});

// A stored 0 is a real, complete answer for some baselines, but the submission
// gate requires a POSITIVE figure — pin both so the rule cannot drift silently.
test("T12 zero and blank are distinguishable after masking", () => {
  const zero = maskConfidentialValues({ isDummy: true, totalVolumeAccepted: 0 });
  const blank = maskConfidentialValues({ isDummy: true, totalVolumeAccepted: null });
  assert.equal(zero.totalVolumeAccepted, 0, "0 must survive as a number, not become a mask");
  assert.equal(blank.totalVolumeAccepted, null, "empty stays empty — never a hidden value");
});

// ── T13 — write isolation is unchanged by the masking fix ───────────────────
test("T13 demo writes are stamped or blocked, production sessions untouched", () => {
  assert.equal(
    decideDemoWrite({ isDemoSession: false, modelName: "DataSLF", isNew: true, targetIsDemoOwned: false }),
    "allow",
    "a real session is never affected",
  );
  assert.equal(
    decideDemoWrite({ isDemoSession: true, modelName: "DataSLF", isNew: true, targetIsDemoOwned: false }),
    "stamp",
    "anything a demo session creates becomes isDummy",
  );
  assert.equal(
    decideDemoWrite({ isDemoSession: true, modelName: "DataSLF", isNew: false, targetIsDemoOwned: false }),
    "block",
    "a demo session can never modify a production record",
  );
  assert.equal(
    decideDemoWrite({ isDemoSession: true, modelName: "DataSLF", isNew: false, targetIsDemoOwned: true }),
    "allow",
  );
});

// ── T14 — the portal baseline payload carries its isolation flag ────────────
test("T14 GET /baseline returns isDummy so the masker can classify it", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "routes", "dataSLF.js"),
    "utf8",
  );
  const handler = source.slice(
    source.indexOf('router.get("/baseline/:slfName"'),
    source.indexOf('router.get("/baselines"'),
  );
  assert.match(handler, /isDummy: latest\.isDummy === true/);
});

test("T14 the portal facility payload selects isDummy", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "routes", "slfFacilities.js"),
    "utf8",
  );
  const handler = source.slice(
    source.indexOf('router.get("/portal/:id"'),
    source.indexOf('router.patch("/portal/:id/facility-details"'),
  );
  assert.match(handler, /"isDummy /, "cell capacities would otherwise be masked for a dummy facility");
});
