import { Space, Tag, Tooltip, Typography } from "antd";
import { VOLUME_METRICS } from "../../../utils/volumeMetrics";

const { Text } = Typography;

// Key for the Cell Infrastructure gauges.
//
// The legend answers "what is this volume made of?" — a declared BASELINE plus
// what portal users SUBMITTED, giving the stored total and the remaining
// headroom. Colours come from the shared palette (utils/volumeMetrics.js), so a
// colour means the same thing on every gauge in the app.
//
// How full a cell is used to be keyed here as three utilization COLOUR bands,
// which forced the reader to decode green/amber/red twice — once as a volume
// metric and once as a fullness band. Fullness is now stated in words as a
// status tag (OK / Near Full / Full), which is what an operator actually needs.

/**
 * Fullness status — the same thresholds that tint the gauge arc, expressed as a
 * plain-language STATUS rather than a colour key.
 *
 * The legend now explains the gauge in terms of what the volume IS (baseline /
 * submitted / stored / remaining); how full a cell happens to be is a warning,
 * not a colour to decode, so it is surfaced as a tag instead.
 */
export const FULLNESS_STATUS = [
  { key: "ok", label: "OK", color: "#52c41a", range: "under 70%", description: "Cell has comfortable headroom." },
  { key: "nearFull", label: "Near Full", color: "#faad14", range: "70–89%", description: "Filling up — plan the next cell." },
  { key: "full", label: "Full", color: "#ff4d4f", range: "90% and over", description: "Near or at capacity — stop directing waste here." },
  { key: "inactive", label: "Inactive", color: "#bfbfbf", range: "—", description: "Closed, completed, reserved or under construction." },
];

/**
 * Resolve a cell's fullness status from its utilization percentage.
 *
 * ONE definition, shared by the legend and any gauge that wants to show the tag,
 * so the wording can never disagree with the arc's own thresholds.
 *
 * @param {number} percent 0–100 utilization
 * @param {boolean} [inactive] cell is closed/completed/reserved/under construction
 */
export function cellFullnessStatus(percent, inactive = false) {
  if (inactive) return FULLNESS_STATUS[3];
  const value = Number(percent);
  if (!Number.isFinite(value)) return FULLNESS_STATUS[0];
  if (value >= 90) return FULLNESS_STATUS[2];
  if (value >= 70) return FULLNESS_STATUS[1];
  return FULLNESS_STATUS[0];
}

// Solid square = a stored volume; dashed square = remaining capacity (headroom,
// not waste), so the two never read as the same kind of figure.
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
      {/* The legend leads with WHAT THE VOLUME IS — baseline, submitted, the
          stored total and the headroom left. That is the question a reader
          actually has in front of a cell gauge. */}
      {showVolumeComposition && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", alignItems: "center" }}>
          <Text strong style={{ fontSize: 11, color: isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)" }}>
            Volume in cell
          </Text>
          <Space size={14} wrap>
            {item(VOLUME_METRICS.baseline)}
            {item(VOLUME_METRICS.submitted)}
            {item(VOLUME_METRICS.stored)}
            {item(VOLUME_METRICS.remaining, true)}
          </Space>
        </div>
      )}

      {/* How full the cell is, as a STATUS rather than a colour to decode. Same
          thresholds that tint the arc (see cellFullnessStatus), so the tag and
          the gauge can never disagree. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 18px",
          alignItems: "center",
          marginTop: showVolumeComposition ? 6 : 0,
        }}
      >
        <Text strong style={{ fontSize: 11, color: isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)" }}>
          Cell status
        </Text>
        <Space size={8} wrap>
          {FULLNESS_STATUS.map((s) => (
            <Tooltip key={s.key} title={s.description}>
              <Tag
                color={s.color}
                style={{ margin: 0, fontSize: 10.5, lineHeight: "18px", borderRadius: 10 }}
              >
                {s.label}
                {s.range !== "—" ? ` · ${s.range}` : ""}
              </Tag>
            </Tooltip>
          ))}
        </Space>
      </div>

      {showVolumeComposition && (
        <Text type="secondary" style={{ fontSize: 10.5, display: "block", marginTop: 6 }}>
          {VOLUME_METRICS.stored.label} = {VOLUME_METRICS.baseline.label} +{" "}
          {VOLUME_METRICS.submitted.label}. The percentage on each gauge is that
          total against the cell&apos;s capacity.
        </Text>
      )}
    </div>
  );
}
