import { Tooltip, Typography } from "antd";
import { VOLUME_METRICS, storedVolumeOf } from "../utils/volumeMetrics";

const { Text } = Typography;

/**
 * Legend for a segmented GaugeMeter.
 *
 * A multi-colour gauge is only readable if each colour maps back to a named
 * metric, so this is rendered wherever `segments` are passed to GaugeMeter. The
 * colours come from the shared palette (utils/volumeMetrics.js), which is what
 * guarantees the legend can never disagree with the arc it describes.
 *
 * With `capacity` supplied it also reports the two DERIVED figures a reader
 * actually wants — "Waste Currently Stored in Cell" (the sum of the segments)
 * and "Remaining Capacity" — without drawing them as segments, which would
 * double-count the volume.
 *
 * @param {Array<{key?:string,label:string,short?:string,value:number,color:string,description?:string}>} segments
 * @param {string} [unit] appended to every value
 * @param {number} [capacity] cell capacity; enables the stored/remaining rows
 * @param {boolean} [compact] smaller type for dense grids
 * @param {boolean} [showTotals] force the derived rows on/off (defaults to !!capacity)
 */
export default function GaugeLegend({
  segments = [],
  unit = "",
  capacity = null,
  compact = false,
  showTotals,
  isDark = false,
}) {
  const visible = segments.filter(
    (segment) => Number.isFinite(Number(segment?.value)) && Number(segment.value) > 0,
  );
  if (!visible.length) return null;

  const fontSize = compact ? 10 : 11.5;
  const muted = isDark ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.65)";
  const format = (value) => `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;

  const stored = storedVolumeOf(visible);
  const hasCapacity = Number.isFinite(Number(capacity)) && Number(capacity) > 0;
  const withTotals = showTotals ?? hasCapacity;
  const remaining = hasCapacity ? Math.max(0, Number(capacity) - stored) : null;

  const row = (metricKey, label, value, color, description) => (
    <Tooltip key={metricKey} title={description}>
      <span
        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize, lineHeight: 1.4 }}
      >
        <span
          aria-hidden
          style={{ width: 8, height: 8, borderRadius: 2, background: color, flex: "0 0 auto" }}
        />
        <Text style={{ fontSize, color: muted }}>{label}</Text>
        <Text strong style={{ fontSize, color }}>
          {format(value)}
        </Text>
      </span>
    </Tooltip>
  );

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: compact ? "2px 8px" : "4px 12px",
        justifyContent: "center",
        marginTop: 6,
      }}
    >
      {visible.map((segment, index) =>
        row(
          segment.key || `${segment.label}-${index}`,
          compact ? segment.short || segment.label : segment.label,
          segment.value,
          segment.color,
          segment.description,
        ),
      )}

      {/* Derived figures — the sum of the segments and what is left. Shown as
          separate legend rows, never as arcs, so the volume is not counted twice. */}
      {withTotals &&
        row(
          "stored",
          compact ? VOLUME_METRICS.stored.short : VOLUME_METRICS.stored.label,
          stored,
          VOLUME_METRICS.stored.color,
          VOLUME_METRICS.stored.description,
        )}
      {withTotals &&
        remaining !== null &&
        row(
          "remaining",
          compact ? VOLUME_METRICS.remaining.short : VOLUME_METRICS.remaining.label,
          remaining,
          // Palette red, in both themes. This previously fell back to a muted
          // gray, which is the one place a legend swatch could disagree with the
          // standard mapping.
          VOLUME_METRICS.remaining.color,
          VOLUME_METRICS.remaining.description,
        )}
    </div>
  );
}
