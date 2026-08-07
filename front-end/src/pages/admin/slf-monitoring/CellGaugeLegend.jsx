import { Space, Tooltip, Typography } from "antd";
import { VOLUME_METRICS } from "../../../utils/volumeMetrics";

const { Text } = Typography;

// The Cell Infrastructure gauges encode TWO independent things, and until now
// neither was labelled — a reader saw coloured arcs with no key.
//
//   • the ARC COLOUR is the utilization band (how full the cell is)
//   • the VOLUME behind that percentage is made of a declared baseline plus
//     volumes submitted through the Portal
//
// Both are explained here, using the same palette as every other gauge in the
// app (utils/volumeMetrics.js), so a colour means the same thing wherever it
// appears.

/** Utilization bands — these MUST match the strokeColor thresholds on the gauges. */
export const UTILIZATION_BANDS = [
  { key: "normal", label: "Under 70%", color: "#52c41a", description: "Cell has comfortable headroom." },
  { key: "elevated", label: "70–89%", color: "#faad14", description: "Filling up — plan the next cell." },
  { key: "nearFull", label: "90% and over", color: "#ff4d4f", description: "Near or at capacity." },
  { key: "inactive", label: "Inactive", color: "#bfbfbf", description: "Closed, completed, reserved or under construction." },
];

// Two DIFFERENT things are keyed in this legend, and since the standard palette
// reuses green/amber/red for both axes the swatch SHAPE is what tells them apart:
//
//   arc glyph  → how the gauge ARC is tinted (utilization band)
//   square     → a named VOLUME metric (baseline / submitted / stored / remaining)
//
// Without this, "green" reads ambiguously as both "under 70% full" and "waste
// stored in cell" in the very same key.
const arcGlyph = (color) => (
  <svg width={14} height={9} viewBox="0 0 14 9" aria-hidden style={{ flex: "0 0 auto" }}>
    <path
      d="M 2 8 A 5 5 0 0 1 12 8"
      fill="none"
      stroke={color}
      strokeWidth={2.5}
      strokeLinecap="round"
    />
  </svg>
);

const swatch = (color, dashed = false) => (
  <span
    aria-hidden
    style={{
      width: 10,
      height: 10,
      borderRadius: 2,
      flex: "0 0 auto",
      background: dashed ? "transparent" : color,
      border: dashed ? `2px dashed ${color}` : "none",
    }}
  />
);

const item = ({ key, label, color, description }, dashed) => (
  <Tooltip key={key} title={description}>
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      {swatch(color, dashed)}
      <Text style={{ fontSize: 11 }}>{label}</Text>
    </span>
  </Tooltip>
);

const bandItem = ({ key, label, color, description }) => (
  <Tooltip key={key} title={description}>
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      {arcGlyph(color)}
      <Text style={{ fontSize: 11 }}>{label}</Text>
    </span>
  </Tooltip>
);

/**
 * @param {boolean} [showVolumeComposition] hide the volume rows when the facility
 *   has no baseline/submitted split recorded (legacy records)
 */
export default function CellGaugeLegend({ isDark = false, showVolumeComposition = true }) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: "8px 10px",
        borderRadius: 8,
        border: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
        background: isDark ? "rgba(255,255,255,0.02)" : "#fff",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", alignItems: "center" }}>
        <Text strong style={{ fontSize: 11, color: isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)" }}>
          Gauge fill
        </Text>
        <Space size={14} wrap>
          {UTILIZATION_BANDS.map((band) => bandItem(band))}
        </Space>
      </div>

      {showVolumeComposition && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "6px 18px",
            alignItems: "center",
            marginTop: 6,
          }}
        >
          <Text strong style={{ fontSize: 11, color: isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)" }}>
            Volume in cell
          </Text>
          <Space size={14} wrap>
            {item(VOLUME_METRICS.baseline)}
            {item(VOLUME_METRICS.submitted)}
            {item(VOLUME_METRICS.stored)}
            {item(VOLUME_METRICS.remaining, true)}
          </Space>
          <Text
            type="secondary"
            style={{ fontSize: 10.5, width: "100%", marginTop: 2 }}
          >
            {VOLUME_METRICS.stored.label} = {VOLUME_METRICS.baseline.label} +{" "}
            {VOLUME_METRICS.submitted.label}. The percentage on each gauge is that
            total against the cell&apos;s capacity. Arc-shaped keys above describe
            how the gauge arc is tinted; square keys describe a volume figure.
          </Text>
        </div>
      )}
    </div>
  );
}
