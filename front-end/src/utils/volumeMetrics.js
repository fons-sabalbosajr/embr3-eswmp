/**
 * THE canonical palette and vocabulary for landfill volume metrics.
 *
 * Every gauge, chart, legend and tile that shows where a cell's waste came from
 * reads from here, so the same concept is the same colour and carries the same
 * words everywhere in the app. Colours previously lived in a dashboard-local
 * file while the Portal's Baseline Breakdown hard-coded a different pair, so the
 * same metric appeared blue in one screen and green in another.
 *
 * ── How the three metrics relate ────────────────────────────────────────────
 *
 *   Baseline Volume   the facility's DECLARED opening volume for the cell
 * + Submitted Volume  volumes recorded through Portal truck submissions
 * ─────────────────
 * = Waste Currently Stored in Cell     ← the filled portion of the gauge
 *
 *   Cell Capacity − Waste Currently Stored = Remaining Capacity
 *
 * "Waste Currently Stored in Cell" is therefore a DERIVED total, never its own
 * gauge segment — drawing it alongside its two parts would double-count the
 * volume. It is shown in the legend as the sum, which is what makes the legend
 * readable rather than just a colour key.
 */

export const VOLUME_METRICS = {
  baseline: {
    key: "baseline",
    label: "Baseline Volume",
    short: "Baseline",
    color: "#2f54eb", // geekblue
    description: "Volume already in the cell when the baseline was declared.",
  },
  submitted: {
    key: "submitted",
    label: "Submitted Volume",
    short: "Submitted",
    color: "#13c2c2", // cyan
    description: "Volume recorded through Portal truck submissions.",
  },
  stored: {
    key: "stored",
    label: "Waste Currently Stored in Cell",
    short: "Stored",
    color: "#722ed1", // purple — the derived total, never a gauge segment
    description: "Baseline Volume + Submitted Volume — the cell's current fill.",
  },
  remaining: {
    key: "remaining",
    label: "Remaining Capacity",
    short: "Remaining",
    color: "#d9d9d9", // matches the gauge track
    description: "Cell Capacity − Waste Currently Stored in Cell.",
  },
  /** Legacy records saved before baseline/submitted were tracked separately. */
  recorded: {
    key: "recorded",
    label: "Recorded Volume",
    short: "Recorded",
    color: "#2f54eb",
    description: "Volume recorded before baseline and submitted totals were split.",
  },
};

// Convenience aliases so call sites never re-declare a hex value.
export const BASELINE_COLOR = VOLUME_METRICS.baseline.color;
export const SUBMITTED_COLOR = VOLUME_METRICS.submitted.color;
export const STORED_COLOR = VOLUME_METRICS.stored.color;
export const REMAINING_COLOR = VOLUME_METRICS.remaining.color;

/**
 * Baseline / Submitted split for ONE cell, ready for GaugeMeter `segments`.
 *
 * Falls back to a single un-split band for legacy records saved before the
 * provenance split existed, so an older facility still renders a filled arc.
 *
 * @param {{baselineFill?:number, submittedFill?:number, fill?:number}} cell
 */
export function cellVolumeSegments(cell = {}) {
  const segments = [];
  if (Number(cell.baselineFill) > 0) {
    segments.push({ ...VOLUME_METRICS.baseline, value: Number(cell.baselineFill) });
  }
  if (Number(cell.submittedFill) > 0) {
    segments.push({ ...VOLUME_METRICS.submitted, value: Number(cell.submittedFill) });
  }
  if (!segments.length && Number(cell.fill) > 0) {
    segments.push({ ...VOLUME_METRICS.recorded, value: Number(cell.fill) });
  }
  return segments;
}

/** Total of a segment list — the "Waste Currently Stored in Cell" figure. */
export function storedVolumeOf(segments = []) {
  return segments.reduce((sum, s) => sum + (Number(s.value) || 0), 0);
}
