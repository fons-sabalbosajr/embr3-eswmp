import { Card, Skeleton, Tooltip, Typography } from "antd";

const { Text } = Typography;

/**
 * Compact KPI tile used across the admin dashboards.
 *
 * Replaces the hand-rolled `<Card><Statistic/></Card>` blocks that were copied
 * per tile: those each hardcoded their own padding, height and font sizes, which
 * is why a row of six could not share one line without wrapping. This component
 * keeps one fixed height and fluid typography so N tiles stay on a single row
 * down to the point where the grid itself wraps them.
 *
 * Visual hierarchy (strongest → weakest): value → icon/accent → title → hint.
 */
export default function SummaryTile({
  accent = "#1677ff",
  icon,
  title,
  titleTooltip,
  value,
  hint,
  loading = false,
  onClick,
  height = 112,
  isDark = false,
}) {
  const clickable = typeof onClick === "function";

  const titleNode = (
    <Text
      style={{
        display: "block",
        fontSize: 11.5,
        lineHeight: 1.25,
        fontWeight: 600,
        letterSpacing: 0.2,
        color: isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.50)",
        // Long labels ("Private Sectors Served") must never push the tile wider
        // than its grid column — that is what forced the row to wrap before.
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {title}
    </Text>
  );

  return (
    <Card
      hoverable={clickable}
      onClick={onClick}
      style={{
        borderRadius: 10,
        height,
        borderLeft: `4px solid ${accent}`,
        cursor: clickable ? "pointer" : "default",
        overflow: "hidden",
      }}
      styles={{ body: { padding: "10px 12px", height: "100%" } }}
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 1, width: "70%" }} title={{ width: "45%" }} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            {icon && (
              <span
                style={{
                  flex: "0 0 auto",
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  color: accent,
                  // Alpha-blended accent works on both light and dark surfaces.
                  background: `${accent}${isDark ? "2e" : "1f"}`,
                }}
              >
                {icon}
              </span>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              {titleTooltip ? <Tooltip title={titleTooltip}>{titleNode}</Tooltip> : titleNode}
            </div>
          </div>

          <div
            style={{
              // Fluid so six tiles on one row never clip their number.
              fontSize: "clamp(19px, 1.55vw, 26px)",
              fontWeight: 600,
              lineHeight: 1.15,
              color: isDark ? "rgba(255,255,255,0.88)" : "rgba(0,0,0,0.88)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {value}
          </div>

          {hint && (
            <div
              style={{
                marginTop: "auto",
                fontSize: 10.5,
                lineHeight: 1.3,
                color: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)",
                // Two lines max, then ellipsis — keeps every tile the same height.
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {hint}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
