/**
 * Name comparison (utils/nameMatch.js): formatting is ignored, letters and
 * words are not. The cases are shared with the front-end's copy of the rule.
 *
 * Run: node --test tests/nameMatch.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const cases = require("./fixtures/nameMatchCases.json");
const { comparableText, sameName } = require("../utils/nameMatch");

test("formatting differences compare equal", () => {
  for (const [a, b] of cases.same) assert.equal(sameName(a, b), true, `${a} = ${b}`);
});

test("real differences — a letter, a word, a number, word order — do not", () => {
  for (const [a, b] of cases.different) assert.equal(sameName(a, b), false, `${a} ≠ ${b}`);
});

test("the relationship check uses this rule", () => {
  const { mergeAccreditedHaulerCopies } = require("../routes/dataSLF");
  const merged = mergeAccreditedHaulerCopies([
    { haulerName: "Northgate Sample Logistics, Inc", clients: [{ clientName: "Brgy.Poblacion" }] },
    { haulerName: "NORTHGATE SAMPLE LOGISTICS INC.", clients: [{ clientName: "Brgy. Poblacion" }] },
  ]);
  assert.equal(merged.length, 1, "one hauler, not two");
  assert.equal(comparableText(""), "");
});
