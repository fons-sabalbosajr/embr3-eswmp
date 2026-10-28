/**
 * Submission History columns fit the table's width.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fitColumnsToWidth, isColumnVisible } from "../columns/fitColumns.js";

const XL = { xs: true, sm: true, md: true, lg: true, xl: true };
const MD = { xs: true, sm: true, md: true };
const COLS = [
  { key: "index", width: 50, responsive: ["md", "lg", "xl", "xxl"] },
  { key: "idNo", width: 150 },
  { key: "company", width: 220, responsive: ["xl", "xxl"] },
  { key: "status", width: 150 },
  { key: "untyped" },
];
const pct = (c) => Number(String(c.width).replace("%", ""));

test("visible columns share exactly the width left after the reserve", () => {
  const fitted = fitColumnsToWidth(COLS, XL, 4);
  const sum = fitted.reduce((s, c) => s + pct(c), 0);
  assert.ok(Math.abs(sum - 96) < 0.01, `sum ${sum}`);
  // Proportions are kept: ID No. is 3x the # column.
  assert.ok(Math.abs(pct(fitted[1]) / pct(fitted[0]) - 3) < 0.01);
});

test("a column hidden at this breakpoint takes no share and keeps its width", () => {
  const fitted = fitColumnsToWidth(COLS, MD, 0);
  assert.equal(fitted[2].width, 220);
  const sum = fitted.filter((c) => isColumnVisible(c, MD)).reduce((s, c) => s + pct(c), 0);
  assert.ok(Math.abs(sum - 100) < 0.01, `sum ${sum}`);
});

test("the portal history table uses it from md up", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, "..", "HistoryPanel.jsx"), "utf8");
  assert.match(src, /fitColumnsToWidth\(historyColumns, screens, EXPAND_COLUMN_PCT\)/);
});
