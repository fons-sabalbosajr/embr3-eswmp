/**
 * Landing hero mockup — counter parsing/formatting.
 *
 * The stat counters animate up to the value ALREADY rendered in Landing.jsx and
 * must land back on that exact string. A rounding or suffix bug here would show
 * as corrupted figures on the public landing page, so the pure part is pinned.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import { parseMetric, formatMetric } from "../landingMockupMotion.js";

// Exactly the values the hero dashboard renders today.
const LIVE_MARKUP_VALUES = ["142", "98", "44", "67.3%", "69%"];

test("every value in the hero mockup round-trips to its authored string", () => {
  for (const original of LIVE_MARKUP_VALUES) {
    const metric = parseMetric(original);
    assert.ok(metric, `"${original}" must parse`);
    assert.equal(
      formatMetric(metric.value, metric),
      original,
      `"${original}" must render back identically at the end of the count-up`,
    );
    assert.equal(metric.original, original);
  }
});

test("decimals are preserved during the count-up, not rounded away", () => {
  const metric = parseMetric("67.3%");
  assert.equal(metric.decimals, 1);
  assert.equal(metric.suffix, "%");
  assert.equal(formatMetric(0, metric), "0.0%");
  assert.equal(formatMetric(31.25, metric), "31.3%");
});

test("whole numbers stay whole and get thousands separators", () => {
  const metric = parseMetric("142");
  assert.equal(metric.decimals, 0);
  assert.equal(formatMetric(0, metric), "0");
  assert.equal(formatMetric(1234.6, metric), "1,235");
});

test("prefixes and suffixes survive", () => {
  const metric = parseMetric("₱1,250.50 M");
  assert.equal(metric.prefix, "₱");
  assert.equal(metric.suffix, " M");
  assert.equal(metric.value, 1250.5);
  assert.equal(formatMetric(metric.value, metric), "₱1250.50 M");
});

test("non-numeric text is left alone rather than mangled", () => {
  for (const text of ["", "  ", "—", "N/A", null, undefined]) {
    assert.equal(parseMetric(text), null, `${JSON.stringify(text)} must not be treated as a counter`);
  }
});

test("the module is import-safe outside a browser (no top-level window access)", async () => {
  const mod = await import("../landingMockupMotion.js");
  assert.equal(typeof mod.startMockupMotion, "function");
  // No root → a no-op cleanup, never a throw.
  assert.equal(typeof mod.startMockupMotion(null, {}), "function");
});
