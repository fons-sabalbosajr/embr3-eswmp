/**
 * Unsaved baseline changes (baselineDirty.js) — Option A: the baseline is never
 * autosaved; unsaved edits are noticed and protected instead.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { portalSource } from "./portalSource.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dayjs from "dayjs";

import { baselineSignature, isBaselineDirty } from "../baselineDirty.js";

const state = (overrides = {}) => ({
  baseline: { totalVolumeAccepted: 1000, dateClosed: dayjs("2026-11-01") },
  company: { lguCompanyName: "Demo SLF" },
  activeCells: [{ key: 1, cellName: "Cell 1", volume: 10 }],
  closedCells: [],
  haulers: [{ key: "h1", haulerName: "Northwind", vehicles: [{ key: "v1", plateNumber: "ABC" }] }],
  mov: { activeCells: [] },
  acceptsHazardous: false,
  ...overrides,
});

test("row keys do not count as changes", () => {
  const a = baselineSignature(state());
  const b = baselineSignature(state({
    activeCells: [{ key: 999, cellName: "Cell 1", volume: 10 }],
    haulers: [{ key: "other", haulerName: "Northwind", vehicles: [{ key: "x", plateNumber: "ABC" }] }],
  }));
  assert.equal(isBaselineDirty(a, b), false);
});

test("an edited value, a new cell entry or a new hauler is a change", () => {
  const clean = baselineSignature(state());
  assert.equal(isBaselineDirty(clean, baselineSignature(state({ baseline: { totalVolumeAccepted: 1200 } }))), true);
  assert.equal(
    isBaselineDirty(clean, baselineSignature(state({ activeCells: [...state().activeCells, { cellName: "Cell 2", volume: 5 }] }))),
    true,
  );
  assert.equal(isBaselineDirty(clean, baselineSignature(state({ haulers: [] }))), true);
});

test("dates compare by day", () => {
  const a = baselineSignature(state());
  const b = baselineSignature(state({ baseline: { totalVolumeAccepted: 1000, dateClosed: dayjs("2026-11-01T15:00:00") } }));
  assert.equal(isBaselineDirty(a, b), false);
});

test("nothing is dirty before the baseline has loaded", () => {
  assert.equal(isBaselineDirty(null, baselineSignature(state())), false);
});

test("the portal protects unsaved edits instead of autosaving them", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const portal = portalSource();
  assert.match(portal, /if \(baselineDirtyRef\.current\(\)\) setBaselineRemoteChanged\(true\);\s*else setBaselineRefresh/);
  assert.match(portal, /confirmDiscardBaseline\("Logging out"\)/);
  assert.match(portal, /confirmDiscardBaseline\("Switching SLF"\)/);
  assert.match(portal, /baselineDirtyGuard\.markClean\(\);/);
});
