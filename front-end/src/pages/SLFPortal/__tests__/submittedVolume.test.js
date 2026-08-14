/**
 * Mini Dashboard → "Submitted Vol." tile.
 *
 * ── The bug this pins ───────────────────────────────────────────────────────
 * The tile rendered `Math.max(0, baselineTotals − totals)` — leftover baseline
 * headroom, which is not a metric this app defines. Two consequences:
 *
 *   • it collapsed to 0 the moment a facility's submissions reached its declared
 *     baseline, which is the reported "missing data";
 *   • when it did show a number, it was the wrong one.
 *
 * Measured against the live API for all 19 portal-assigned SLFs: 3 showed 0 while
 * holding real submitted volume (Floridablanca 33,282 tons, Santa Rosa 7,884 m³,
 * Guimba 943 m³), and the other 16 showed an unrelated figure — e.g. Porac read
 * 1,804,105 where the submitted volume is 108,893 m³.
 *
 * Submitted Volume has one definition in this app (see utils/volumeMetrics.js):
 * volume recorded through Portal truck submissions — the API's `totals`, which
 * the route sums from each record's trucks[]. It is independent of the baseline.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  submittedVolumeOf,
  baselineVolumeOf,
  storedVolumeFor,
  VOLUME_METRICS,
} from "../../../utils/volumeMetrics.js";

// Shape of GET /data-slf/waste-received-summary.
const SUMMARY = {
  totals: { m3: 7884.5, tons: 4102.25, trucks: 61 },
  baselineTotals: { m3: 6525.39, tons: 3300 },
};

test("Submitted Vol. reads the SUBMITTED totals, never the baseline", () => {
  assert.equal(submittedVolumeOf(SUMMARY, "m³"), 7884.5);
  assert.equal(baselineVolumeOf(SUMMARY, "m³"), 6525.39);
  assert.notEqual(
    submittedVolumeOf(SUMMARY, "m³"),
    Math.max(0, SUMMARY.baselineTotals.m3 - SUMMARY.totals.m3),
    "the old formula and the metric must not be confused again",
  );
});

test("the figure is reported in the facility's declared unit", () => {
  assert.equal(submittedVolumeOf(SUMMARY, "tons"), 4102.25);
  assert.equal(submittedVolumeOf(SUMMARY, "m3"), 7884.5, "the legacy 'm3' spelling normalizes to m³");
  assert.equal(submittedVolumeOf(SUMMARY, "m³"), 7884.5);
  assert.equal(submittedVolumeOf(SUMMARY), 7884.5, "m³ is the default");
});

test("REGRESSION — submissions past the baseline no longer read as zero", () => {
  // Santa Rosa: 7884 m³ submitted against a 0 m³ baseline block.
  const santaRosa = { totals: { m3: 7884, tons: 0 }, baselineTotals: { m3: 0, tons: 0 } };
  assert.equal(Math.max(0, 0 - 7884), 0, "the old formula produced 0 here");
  assert.equal(submittedVolumeOf(santaRosa, "m³"), 7884, "the tile now shows the real submitted volume");

  // Floridablanca: 33,282 tons submitted, baseline block empty in tons.
  const floridablanca = { totals: { m3: 0, tons: 33282 }, baselineTotals: { m3: 0, tons: 0 } };
  assert.equal(submittedVolumeOf(floridablanca, "tons"), 33282);
});

test("a genuine zero is 0, not null or undefined — the tile must render it", () => {
  const nothingYet = { totals: { m3: 0, tons: 0 }, baselineTotals: { m3: 25600, tons: 0 } };
  const value = submittedVolumeOf(nothingYet, "m³");
  assert.equal(value, 0);
  assert.equal(typeof value, "number");
  assert.ok(!Number.isNaN(value));
  // This is what the tile formats; a real zero must survive it as "0".
  assert.equal(`${Number(value || 0).toLocaleString()}`, "0");
});

test("missing / malformed data degrades to 0 instead of throwing", () => {
  assert.equal(submittedVolumeOf({}, "m³"), 0, "an SLF with no summary yet");
  assert.equal(submittedVolumeOf(undefined, "m³"), 0);
  assert.equal(submittedVolumeOf(null, "m³"), 0, "an API failure leaves the state null");
  assert.equal(submittedVolumeOf({ totals: null }, "m³"), 0);
  assert.equal(submittedVolumeOf({ totals: {} }, "tons"), 0);
  assert.equal(submittedVolumeOf({ totals: { m3: "not a number" } }, "m³"), 0);
  // The portal resets wasteReceivedData to this exact shape when the request fails.
  const onError = { baselineClients: [], baselineTotals: { m3: 0, tons: 0 }, totals: { m3: 0, tons: 0, trucks: 0 } };
  assert.equal(submittedVolumeOf(onError, "m³"), 0);
});

test("baseline + submitted is the stored total, and they stay independent", () => {
  // The relationship the whole gauge vocabulary rests on.
  assert.equal(storedVolumeFor(SUMMARY, "m³"), 6525.39 + 7884.5);
  // Changing the baseline must not move the submitted figure.
  const biggerBaseline = { ...SUMMARY, baselineTotals: { m3: 999999, tons: 0 } };
  assert.equal(submittedVolumeOf(biggerBaseline, "m³"), 7884.5);
});

test("the tile is coloured as Submitted Volume, matching the chart beside it", () => {
  assert.equal(VOLUME_METRICS.submitted.color, "#faad14");
  assert.equal(VOLUME_METRICS.submitted.label, "Submitted Volume");
});
