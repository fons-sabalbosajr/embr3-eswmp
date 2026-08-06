// ── Volume-contribution colours ──
// A gauge is drawn as one coloured band per contribution so a reader can tell
// which volume came from where. Baseline (the facility's declared opening
// volume) and Submitted (portal truck entries) are fixed, semantic colours;
// per-cell bands use the SLF identity palette (getSlfColor).
export const BASELINE_SEGMENT_COLOR = "#2f54eb"; // geekblue — declared baseline
export const SUBMITTED_SEGMENT_COLOR = "#13c2c2"; // cyan — portal submissions

/**
 * Baseline / Submitted split for ONE cell, ready for GaugeMeter `segments`.
 * Falls back to a single un-split band for legacy records saved before the
 * provenance split existed, so an older facility still renders a filled arc.
 */
export function cellVolumeSegments(cell) {
  const segments = [];
  if (cell.baselineFill > 0) {
    segments.push({ key: "baseline", label: "Baseline", value: cell.baselineFill, color: BASELINE_SEGMENT_COLOR });
  }
  if (cell.submittedFill > 0) {
    segments.push({ key: "submitted", label: "Submitted", value: cell.submittedFill, color: SUBMITTED_SEGMENT_COLOR });
  }
  if (!segments.length && Number(cell.fill) > 0) {
    segments.push({ key: "recorded", label: "Recorded", value: Number(cell.fill), color: BASELINE_SEGMENT_COLOR });
  }
  return segments;
}
