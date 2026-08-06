import { Typography } from "antd";

const { Text } = Typography;

/**
 * Compact colour key for a segmented GaugeMeter.
 *
 * A multi-colour gauge is only readable if the reader can map each colour back
 * to its source, so this is rendered wherever `segments` are passed to
 * GaugeMeter. Kept separate from the gauge itself because the two are laid out
 * differently depending on the card (below the arc, or beside it).
 *
 * @param {Array<{key?:string,label:string,value:number,color:string}>} segments
 * @param {string} [unit] appended to each value
 * @param {boolean} [compact] smaller type + tighter spacing for dense grids
 */
export default function GaugeLegend({ segments = [], unit = "", compact = false, isDark = false }) {
  const visible = segments.filter((segment) => Number.isFinite(Number(segment?.value)) && Number(segment.value) > 0);
  if (!visible.length) return null;

  const fontSize = compact ? 10 : 11.5;

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
      {visible.map((segment, index) => (
        <span
          key={segment.key || `${segment.label}-${index}`}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize, lineHeight: 1.4 }}
          title={`${segment.label}: ${Number(segment.value).toLocaleString()}${unit ? ` ${unit}` : ""}`}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: segment.color,
              flex: "0 0 auto",
            }}
          />
          <Text style={{ fontSize, color: isDark ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.65)" }}>
            {segment.label}
          </Text>
          <Text strong style={{ fontSize, color: segment.color }}>
            {Number(segment.value).toLocaleString()}
          </Text>
        </span>
      ))}
    </div>
  );
}
