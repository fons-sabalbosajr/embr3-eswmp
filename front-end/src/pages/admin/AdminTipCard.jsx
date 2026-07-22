import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Typography, Button, Tooltip, Tag } from "antd";
import { BulbOutlined, LeftOutlined, RightOutlined } from "@ant-design/icons";

const { Text } = Typography;

// Centralized tip config (frontend constant — no backend fetch). Covers BOTH
// Admin and SLF Portal workflows; each tip carries a category label. Concise and
// non-sensitive (no credentials, debug steps, or developer-only internals).
const CATEGORY_COLORS = { Admin: "blue", Portal: "green", "Data Entry": "cyan", Validation: "gold", Security: "red" };
const ADMIN_TIPS = [
  // Admin
  { cat: "Admin", text: "Click a Main Dashboard summary tile to open its filtered record view." },
  { cat: "Admin", text: "On the SLF Location Map, pick a date to see each SLF's submission status for that day." },
  { cat: "Admin", text: "Review pending submissions quickly from the SLF Disposal Calendar's yellow markers." },
  { cat: "Admin", text: "Use Hauler Clients filters to find portal-user and hauler relationships fast." },
  { cat: "Admin", text: "Client regional classification uses the saved province — keep locations complete." },
  { cat: "Admin", text: "Export records before performing large manual updates so you can roll back." },
  { cat: "Admin", text: "Maintain the Region 3 LGU master data to keep client classification accurate." },
  // Validation / Security
  { cat: "Validation", text: "Acknowledged submissions turn the SLF map marker blue; pending stays yellow." },
  { cat: "Validation", text: "Check incomplete client locations before generating regional reports." },
  { cat: "Validation", text: "Use App Logs to spot recurring portal errors and failed submissions." },
  { cat: "Security", text: "Review a role's permissions in Manage Access before assigning it to a user." },
  { cat: "Admin", text: "Refresh the map's status layer after acknowledging or reverting submissions." },
  // Portal / Data Entry
  { cat: "Portal", text: "Portal users encode active cells under Data Entry → Baseline Data first." },
  { cat: "Data Entry", text: "Organize Cells lists only the portal user's active baseline cells." },
  { cat: "Data Entry", text: "Waste Volume submissions must target an active assigned cell." },
  { cat: "Portal", text: "Add hauler and client details (name, type, province, city) before submitting." },
  { cat: "Data Entry", text: "Bulk uploads are validated row-by-row and previewed before saving." },
  { cat: "Portal", text: "Exported baseline files can be edited offline and re-uploaded to update records." },
  { cat: "Portal", text: "Submissions preserve your draft data and recover after a network interruption." },
];

const ROTATE_MS = 8000;
const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

// Isolated + memoized so the rotating tip state never re-renders the Main
// Dashboard. One controlled interval; paused on tab-hidden and hover/focus.
// Fixed height (no layout shift), responsive width, up to 3 lines of tip text.
function AdminTipCard({ isDark }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const pausedRef = useRef(false);
  const reduced = prefersReducedMotion();

  const advance = useCallback((dir = 1) => {
    if (reduced) {
      setIndex((i) => (i + dir + ADMIN_TIPS.length) % ADMIN_TIPS.length);
      return;
    }
    setVisible(false);
    window.setTimeout(() => {
      setIndex((i) => (i + dir + ADMIN_TIPS.length) % ADMIN_TIPS.length);
      setVisible(true);
    }, 240);
  }, [reduced]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (pausedRef.current || document.hidden) return;
      advance(1);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [advance]);

  const pause = () => { pausedRef.current = true; };
  const resume = () => { pausedRef.current = false; };

  const tip = ADMIN_TIPS[index];

  return (
    <div
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        minHeight: 56,
        padding: "6px 12px",
        borderRadius: 8,
        border: `1px solid ${isDark ? "rgba(250,173,20,0.35)" : "#ffe58f"}`,
        borderLeft: "3px solid #faad14",
        background: isDark ? "rgba(250,173,20,0.08)" : "#fffbe6",
        minWidth: 280,
        maxWidth: 620,
        flex: "1 1 380px",
        boxSizing: "border-box",
      }}
    >
      <BulbOutlined style={{ color: "#faad14", fontSize: 17, flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 1 }}>
          <Text strong style={{ fontSize: 11, color: "#d48806" }}>Reminders Here!</Text>
          <Tag color={CATEGORY_COLORS[tip.cat] || "default"} style={{ fontSize: 9, lineHeight: "15px", margin: 0, padding: "0 5px" }}>{tip.cat}</Tag>
        </div>
        <Tooltip title={tip.text}>
          <Text
            aria-live="polite"
            title={tip.text}
            style={{
              fontSize: 12,
              lineHeight: 1.3,
              opacity: reduced ? 1 : visible ? 1 : 0,
              transition: reduced ? "none" : "opacity 0.22s ease",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {tip.text}
          </Text>
        </Tooltip>
      </div>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <span style={{ display: "flex" }}>
          <Button type="text" size="small" aria-label="Previous tip" icon={<LeftOutlined style={{ fontSize: 10 }} />} onClick={() => advance(-1)} />
          <Button type="text" size="small" aria-label="Next tip" icon={<RightOutlined style={{ fontSize: 10 }} />} onClick={() => advance(1)} />
        </span>
        <Text type="secondary" style={{ fontSize: 9, lineHeight: 1 }} aria-hidden>{index + 1}/{ADMIN_TIPS.length}</Text>
      </span>
    </div>
  );
}

export default memo(AdminTipCard);
