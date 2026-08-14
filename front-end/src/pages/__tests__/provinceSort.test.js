/**
 * Province ordering — shared by the Dashboard's Cell Infrastructure modal, the
 * LGUs & Private Sectors summary, and the Client Relationship tabs. One rule, so
 * the same province can't sit in a different place depending on the screen.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import { compareProvinceNames, sortByProvince } from "../../utils/provinceSort.js";

const order = (list) => [...list].sort(compareProvinceNames);

test("provinces sort A→Z", () => {
  assert.deepEqual(
    order(["Zambales", "Bulacan", "Aurora", "Tarlac", "Pampanga"]),
    ["Aurora", "Bulacan", "Pampanga", "Tarlac", "Zambales"],
  );
});

test("case and stray whitespace do not affect the order", () => {
  assert.deepEqual(
    order(["  zambales ", "BULACAN", "Aurora"]),
    ["Aurora", "BULACAN", "  zambales "],
  );
});

test('"Province of X" sorts under X, not under P', () => {
  // Otherwise every "Province of …" clusters together under P.
  assert.deepEqual(
    order(["Province of Tarlac", "Aurora", "Province of Bulacan"]),
    ["Aurora", "Province of Bulacan", "Province of Tarlac"],
  );
});

test("missing / Unspecified always sorts LAST, never in the middle", () => {
  assert.deepEqual(
    order(["Zambales", "Unspecified", "Aurora"]),
    ["Aurora", "Zambales", "Unspecified"],
  );
  assert.deepEqual(order(["Tarlac", "", "Aurora"]), ["Aurora", "Tarlac", ""]);
});

test("null and undefined are handled rather than throwing", () => {
  assert.doesNotThrow(() => order(["Aurora", null, undefined, "Bulacan"]));
  const sorted = order(["Aurora", null, undefined, "Bulacan"]);
  assert.deepEqual(sorted.slice(0, 2), ["Aurora", "Bulacan"], "real names come first");
});

test("sortByProvince orders objects and returns a NEW array", () => {
  const rows = [{ province: "Zambales" }, { province: "Aurora" }, { province: "Pampanga" }];
  const sorted = sortByProvince(rows);
  assert.deepEqual(sorted.map((r) => r.province), ["Aurora", "Pampanga", "Zambales"]);
  assert.equal(rows[0].province, "Zambales", "the input must not be mutated");
});

test("sortByProvince accepts a custom accessor and tolerates junk input", () => {
  const rows = [{ p: "Tarlac" }, { p: "Bulacan" }];
  assert.deepEqual(sortByProvince(rows, (r) => r.p).map((r) => r.p), ["Bulacan", "Tarlac"]);
  assert.deepEqual(sortByProvince(null), []);
});
