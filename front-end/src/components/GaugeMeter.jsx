import { useId } from "react";

// Lightweight, dependency-free SVG semicircular gauge.
//
// Reusable across dashboards for "X of capacity used" style metrics. No heavy
// chart library — just an inline SVG arc so it renders instantly and themes with
// a passed-in color.
//
// Percent rules (per SLF dashboard spec):
//   • Clamped to 0–100.
//   • Displayed to a maximum of 2 decimal places.
//   • When `percent` is null/undefined/NaN (required capacity values missing),
//     the gauge shows `noDataText` ("No capacity data available") instead of a
//     fabricated 0%.
//
// Helper `computeGaugePercent({ usedCapacity, totalCapacity, remainingCapacity })`
// implements the agreed calculation and returns `null` when data is missing.

export function computeGaugePercent({ usedCapacity, totalCapacity, remainingCapacity } = {}) {
  const total = Number(totalCapacity);
  if (!Number.isFinite(total) || total <= 0) return null;
  let used;
  if (Number.isFinite(Number(usedCapacity))) {
    used = Number(usedCapacity);
  } else if (Number.isFinite(Number(remainingCapacity))) {
    used = total - Number(remainingCapacity);
  } else {
    return null;
  }
  const pct = (used / total) * 100;
  return Math.min(100, Math.max(0, pct));
}

export default function GaugeMeter({
  percent,
  label,
  valueText,
  color = "#2f54eb",
  trackColor = "#eef0f4",
  size = 132,
  thickness = 12,
  noDataText = "No capacity data available",
  // Font sizes are configurable so the same gauge works both full-size and as a
  // compact in-table chart without oversized text.
  percentFontSize = 20,
  noDataFontSize = 11,
  labelFontSize = 12,
  // Operational-state modifiers (see utils/cellVisuals → getCellStatusConfig).
  // They change HOW the arc is drawn, never its colour — the colour stays owned
  // by the cell TYPE so the two axes never conflict.
  //   "solid"  normal · "muted" faded · "dashed" not-yet-real · "none" no arc
  fillStyle = "solid",
  fillOpacity = 1,
}) {
  const hasData = percent != null && Number.isFinite(Number(percent));
  const pct = hasData ? Math.min(100, Math.max(0, Number(percent))) : 0;
  // Max 2 decimals, without trailing ".00" noise.
  const pctLabel = hasData ? `${parseFloat(pct.toFixed(2))}%` : null;

  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const arcLength = Math.PI * r; // top semicircle
  const dashOffset = arcLength * (1 - pct / 100);
  const arcPath = `M ${thickness / 2} ${cy} A ${r} ${r} 0 0 1 ${size - thickness / 2} ${cy}`;
  const svgHeight = cy + thickness;

  // A "dashed" cell draws its filled portion as a broken arc. The fill length is
  // still driven by `pct`, so the dash pattern has to be composed against a
  // clip-free stroke: draw the arc masked to `pct` via a second path.
  const dashPattern = fillStyle === "dashed" ? `${Math.max(3, thickness * 0.9)} ${Math.max(2, thickness * 0.6)}` : null;
  const showArc = hasData && fillStyle !== "none";
  // SVG ids are document-global, and many gauges render at once. useId gives one
  // stable unique id per mounted instance — stable across rerenders, so the
  // clipPath is not recreated on every render.
  const gaugeId = useId().replace(/:/g, "");
  const clipPathId = `gauge-clip-${gaugeId}`;

  return (
    <div style={{ textAlign: "center", width: size, margin: "0 auto" }}>
      <div style={{ position: "relative" }}>
        <svg width={size} height={svgHeight} viewBox={`0 0 ${size} ${svgHeight}`}>
          <path
            d={arcPath}
            fill="none"
            stroke={trackColor}
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={fillStyle === "dashed" || fillStyle === "none" ? "3 3" : undefined}
          />
          {showArc && (
            <g opacity={fillOpacity}>
              {/* Length-limited to `pct` by the dashoffset trick, then optionally
                  re-dashed for the "dashed" state via a stroke on a clipped copy. */}
              {dashPattern ? (
                <>
                  <defs>
                    <clipPath id={clipPathId}>
                      <path
                        d={arcPath}
                        fill="none"
                        stroke="#000"
                        strokeWidth={thickness + 2}
                        strokeLinecap="butt"
                        strokeDasharray={arcLength}
                        strokeDashoffset={dashOffset}
                      />
                    </clipPath>
                  </defs>
                  <path
                    d={arcPath}
                    fill="none"
                    stroke={color}
                    strokeWidth={thickness}
                    strokeLinecap="butt"
                    strokeDasharray={dashPattern}
                    clipPath={`url(#${clipPathId})`}
                  />
                </>
              ) : (
                <path
                  d={arcPath}
                  fill="none"
                  stroke={color}
                  strokeWidth={thickness}
                  strokeLinecap="round"
                  strokeDasharray={arcLength}
                  strokeDashoffset={dashOffset}
                />
              )}
            </g>
          )}
        </svg>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            fontSize: hasData ? percentFontSize : noDataFontSize,
            fontWeight: hasData ? 700 : 500,
            color: hasData ? color : "#8c8c8c",
            lineHeight: 1.15,
            padding: "0 6px",
          }}
        >
          {hasData ? pctLabel : noDataText}
        </div>
      </div>
      {valueText && (
        <div style={{ fontSize: labelFontSize, color: "#595959", marginTop: 2 }}>{valueText}</div>
      )}
      {label && (
        <div style={{ fontSize: labelFontSize, fontWeight: 600, marginTop: 2 }}>{label}</div>
      )}
    </div>
  );
}
