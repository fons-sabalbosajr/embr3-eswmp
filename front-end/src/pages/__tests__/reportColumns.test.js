/**
 * Reporting Summary tables: column widths always total exactly 100%, so a
 * fixed-layout table never grows past the modal.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import { fitColumnWidths } from "../admin/reportColumns.js";

const total = (cols) => cols.reduce((s, c) => s + parseFloat(c.width), 0);

test("100% of columns plus a 40 px Remove column is scaled back to 100%", () => {
  const cols = fitColumnWidths([
    { width: "19%" }, { width: "17%" }, { width: "19%" }, { width: "7%" },
    { width: "7%" }, { width: "11%" }, { width: "10%" }, { width: "10%" }, { width: 40 },
  ]);
  assert.ok(Math.abs(total(cols) - 100) < 0.01);
  assert.ok(cols.every((c) => String(c.width).endsWith("%")), "no pixel widths remain");
});

test("columns without a width share what is left", () => {
  const cols = fitColumnWidths([{ width: "50%" }, {}, {}]);
  assert.ok(Math.abs(total(cols) - 100) < 0.01);
  assert.equal(cols[1].width, cols[2].width);
});

test("ellipsis is always switched off so text wraps", () => {
  assert.equal(fitColumnWidths([{ width: "100%", ellipsis: true }])[0].ellipsis, false);
});
