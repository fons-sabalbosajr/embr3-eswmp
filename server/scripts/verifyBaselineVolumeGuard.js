/**
 * Regression check for the Total Volume Accepted partial-update guard.
 *
 * No test framework is configured in this project, so this is a self-contained
 * assertion runner: it exercises resolveTotalVolumeForUpdate() — the single helper
 * both the portal and admin baseline save paths use — and exits non-zero on any
 * failure. Run it in CI or before deploys to guarantee the field can never again
 * be silently blanked (or a zero treated as missing).
 *
 * Usage:  node scripts/verifyBaselineVolumeGuard.js
 */
const assert = require("assert");
const { resolveTotalVolumeForUpdate } = require("../utils/baselineVolume");

const cases = [
  // [input, expected]
  ["empty string preserves", "", { apply: false }],
  ["null preserves", null, { apply: false }],
  ["undefined preserves", undefined, { apply: false }],
  ["non-numeric preserves", "abc", { apply: false }],
  ["NaN preserves", NaN, { apply: false }],
  ["zero applies (valid value)", 0, { apply: true, value: 0 }],
  ["positive number applies", 1500, { apply: true, value: 1500 }],
  ["numeric string coerced", "1500", { apply: true, value: 1500 }],
  ["decimal string coerced", "12.5", { apply: true, value: 12.5 }],
  ["zero string applies", "0", { apply: true, value: 0 }],
];

let failed = 0;
for (const [name, input, expected] of cases) {
  try {
    const got = resolveTotalVolumeForUpdate(input);
    assert.deepStrictEqual(got, expected);
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} Total Volume guard assertions passed.`);
