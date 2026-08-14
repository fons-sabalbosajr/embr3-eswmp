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

/**
 * ── THE standard gauge palette ───────────────────────────────────────────────
 *
 *   Blue          Baseline Volume
 *   Golden Yellow Submitted Volume
 *   Green         Waste Currently Stored in Cell (actual cell volume)
 *   Red           Remaining / Critical Capacity, and the overflow indicator
 *
 * These four hues are the ONLY colours any gauge, legend or volume chart may
 * use for these four concepts, on every screen. Nothing downstream re-declares
 * a hex — call sites read from here (or from the aliases below) so a colour can
 * never mean one thing on the dashboard and something else in a modal.
 */
export const VOLUME_METRICS = {
  baseline: {
    key: "baseline",
    label: "Baseline Volume",
    short: "Baseline",
    color: "#1677ff", // blue
    description: "Volume already in the cell when the baseline was declared.",
  },
  submitted: {
    key: "submitted",
    label: "Submitted Volume",
    short: "Submitted",
    color: "#faad14", // golden yellow
    description: "Volume recorded through Portal truck submissions.",
  },
  stored: {
    key: "stored",
    label: "Waste Currently Stored in Cell",
    short: "Stored",
    color: "#52c41a", // green — the derived total, never a gauge segment
    description: "Baseline Volume + Submitted Volume — the cell's current fill.",
  },
  remaining: {
    key: "remaining",
    label: "Remaining Capacity",
    short: "Remaining",
    color: "#ff4d4f", // red — headroom left, and the critical/overflow signal
    description: "Cell Capacity − Waste Currently Stored in Cell.",
  },
  /** Legacy records saved before baseline/submitted were tracked separately. */
  recorded: {
    key: "recorded",
    label: "Recorded Volume",
    short: "Recorded",
    color: "#1677ff",
    description: "Volume recorded before baseline and submitted totals were split.",
  },
  /**
   * A Waste in Cell figure an admin typed by hand (SLF Table → Edit → Waste in
   * Cell). It REPLACES the derived total for that cell, so it has no
   * baseline/submitted split behind it — labelling it as its own contribution is
   * what stops a hand-entered number from being read as recorded data.
   */
  adminSet: {
    key: "adminSet",
    label: "Admin-Set Volume",
    short: "Admin-set",
    color: "#722ed1", // purple — distinct from every derived metric
    description: "Entered directly by an admin; replaces the calculated baseline + submitted total for this cell.",
  },
};

/**
 * Neutral track behind a gauge arc. This is deliberately NOT `remaining.color`:
 * the unfilled arc is chrome, whereas Remaining Capacity is a named metric that
 * the legend reports in red. Keeping them separate is what lets the track stay
 * visually quiet without weakening the red signal.
 */
export const GAUGE_TRACK_COLOR = "#eef0f4";

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
  // An admin-declared figure REPLACES the derived total, so it is the whole arc.
  // Showing the derived baseline/submitted split beside it would present numbers
  // that do not add up to the value on screen.
  if (cell.overridden && Number(cell.fill) > 0) {
    return [{ ...VOLUME_METRICS.adminSet, value: Number(cell.fill) }];
  }
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

/**
 * Read one side of a waste-received summary in the facility's declared unit.
 *
 * `GET /data-slf/waste-received-summary` reports m³ and tons side by side; a
 * facility declares ONE unit, and every portal figure is shown in it.
 *
 * @param {{m3?:number, tons?:number}} totals a `totals` / `baselineTotals` block
 * @param {string} unit the facility's declared unit
 */
function totalInUnit(totals, unit) {
  const value = String(unit || "m³").replace("m3", "m³") === "tons" ? totals?.tons : totals?.m3;
  const numeric = Number(value);
  // `Number(x || 0)` is not enough: a non-numeric string is truthy, so it reaches
  // Number() and yields NaN — which the tile would render literally as "NaN".
  // Anything that is not a finite number means "nothing recorded", i.e. 0.
  return Number.isFinite(numeric) ? numeric : 0;
}

/**
 * SUBMITTED VOLUME — volume recorded through Portal truck submissions.
 *
 * This is the API's `totals`, which is the sum over `submissionClients`, which
 * the route builds from each record's `trucks[]`. It is deliberately NOT derived
 * from the baseline: baseline and submitted are two independent quantities whose
 * SUM is the cell's current fill (see the header of this file).
 *
 * The Portal's "Submitted Vol." tile used to render
 * `Math.max(0, baselineTotals − totals)` — leftover baseline headroom, which is
 * not a metric this app defines, and which reads as 0 for any facility whose
 * submissions have reached its declared baseline. Three live SLFs showed 0 that
 * way while holding real submitted volume. Exported so the tile and its test read
 * the same definition.
 *
 * @param {object} wasteReceivedData the summary response
 * @param {string} unit the facility's declared unit
 * @returns {number} 0 when there is nothing submitted — never null/undefined, so
 *   a genuine zero renders as "0" rather than as an empty tile.
 */
export function submittedVolumeOf(wasteReceivedData = {}, unit = "m³") {
  return totalInUnit(wasteReceivedData?.totals, unit);
}

/** BASELINE VOLUME — the facility's declared opening volume, in `unit`. */
export function baselineVolumeOf(wasteReceivedData = {}, unit = "m³") {
  return totalInUnit(wasteReceivedData?.baselineTotals, unit);
}

/**
 * WASTE CURRENTLY STORED — baseline + submitted, the derived total.
 * Never its own gauge segment; see the header.
 */
export function storedVolumeFor(wasteReceivedData = {}, unit = "m³") {
  return baselineVolumeOf(wasteReceivedData, unit) + submittedVolumeOf(wasteReceivedData, unit);
}
