// Dashboard VERA card — VERA presents rotating tips & reminders for admins, under
// the VERA visual identity (animated blue→green flame). Reuses the tip rotation
// pattern of the old Admin Tip card but framed as VERA guidance, and adds an
// "Ask VERA" action that opens the already-mounted VeraChat via the `vera:open`
// event (no duplicate chat instance).
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Typography, Button, Tooltip, Tag } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import VeraFlameIcon from "../../components/VeraFlameIcon";

const { Text } = Typography;

const CATEGORY_COLORS = { Admin: "blue", Portal: "green", "Data Entry": "cyan", Validation: "gold", Security: "red" };

// VERA tips & reminders — concise, non-sensitive admin/portal workflow guidance
// (no credentials, debug steps, or developer-only internals).
const VERA_TIPS = [
  { cat: "Admin", text: "Click a Main Dashboard summary tile to open its filtered record view." },
  { cat: "Admin", text: "On the SLF Location Map, pick a date to see each SLF's submission status for that day." },
  { cat: "Admin", text: "Review pending submissions quickly from the SLF Disposal Calendar's yellow markers." },
  { cat: "Admin", text: "Switch the Disposal Calendar to Year view for a month-by-month submission summary." },
  { cat: "Admin", text: "Use Hauler Clients filters to find portal-user and hauler relationships fast." },
  { cat: "Admin", text: "Export records before performing large manual updates so you can roll back." },
  { cat: "Admin", text: "Maintain the Region 3 LGU master data to keep client classification accurate." },
  { cat: "Admin", text: "Reviewing Prevention Measures? Generate a VERA document summary for a quick read." },
  { cat: "Validation", text: "Acknowledged submissions turn the SLF map marker blue; pending stays yellow." },
  { cat: "Validation", text: "Reverted and rejected submissions now show distinct map markers for the selected date." },
  { cat: "Validation", text: "Use App Logs to spot recurring portal errors and failed submissions." },
  { cat: "Security", text: "Review a role's permissions in Manage Access before assigning it to a user." },
  { cat: "Admin", text: "Ask VERA how to approve a submission, read a status, or find a report." },
  { cat: "Portal", text: "Portal users encode active cells under Data Entry → Baseline Data first." },
  { cat: "Data Entry", text: "Organize Cells lists only the portal user's active baseline cells." },
  { cat: "Portal", text: "Add hauler and client details (name, type, province, city) before submitting." },
  { cat: "Data Entry", text: "Bulk uploads are validated row-by-row and previewed before saving." },
  { cat: "Portal", text: "Submissions preserve draft data and recover after a network interruption." },
];

const ROTATE_MS = 8000;
const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

function VeraCard({ isDark }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const pausedRef = useRef(false);
  const reduced = prefersReducedMotion();

  const advance = useCallback((dir = 1) => {
    if (reduced) {
      setIndex((i) => (i + dir + VERA_TIPS.length) % VERA_TIPS.length);
      return;
    }
    setVisible(false);
    window.setTimeout(() => {
      setIndex((i) => (i + dir + VERA_TIPS.length) % VERA_TIPS.length);
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
  const openVera = () => window.dispatchEvent(new CustomEvent("vera:open"));

  const tip = VERA_TIPS[index];

  return (
    <div
      role="region"
      aria-label="VERA tips and reminders"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        minHeight: 58,
        padding: "6px 12px",
        borderRadius: 12,
        border: `1px solid ${isDark ? "rgba(19,194,194,0.35)" : "rgba(19,194,194,0.28)"}`,
        background: isDark
          ? "linear-gradient(135deg, rgba(22,119,255,0.12) 0%, rgba(82,196,26,0.12) 100%)"
          : "linear-gradient(135deg, rgba(22,119,255,0.07) 0%, rgba(82,196,26,0.10) 100%)",
        boxShadow: "0 0 0 1px rgba(19,194,194,0.06), 0 6px 18px rgba(19,194,194,0.10)",
        minWidth: 300,
        maxWidth: 640,
        flex: "1 1 400px",
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          flex: "0 0 auto",
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: isDark ? "#0f1a2b" : "#fff",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "inset 0 0 0 2px rgba(19,194,194,0.25)",
        }}
      >
        <VeraFlameIcon size={24} />
      </span>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 1, flexWrap: "wrap" }}>
          <Text strong style={{ fontSize: 11, color: isDark ? "#5cd6d6" : "#08979c" }}>
            VERA Tips &amp; Reminders
          </Text>
          <Tag color={CATEGORY_COLORS[tip.cat] || "default"} style={{ fontSize: 9, lineHeight: "15px", margin: 0, padding: "0 5px" }}>{tip.cat}</Tag>
        </div>
        <Tooltip title={tip.text}>
          <Text
            aria-live="polite"
            style={{
              fontSize: 12,
              lineHeight: 1.3,
              color: isDark ? "#cfe3f5" : "#14243b",
              opacity: reduced ? 1 : visible ? 1 : 0,
              transition: reduced ? "none" : "opacity 0.22s ease",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {tip.text}
          </Text>
        </Tooltip>
      </div>

      <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flexShrink: 0 }}>
        <span style={{ display: "flex" }}>
          <Button type="text" size="small" aria-label="Previous tip" icon={<LeftOutlined style={{ fontSize: 10 }} />} onClick={() => advance(-1)} />
          <Button type="text" size="small" aria-label="Next tip" icon={<RightOutlined style={{ fontSize: 10 }} />} onClick={() => advance(1)} />
        </span>
        <Button
          size="small"
          type="primary"
          onClick={openVera}
          style={{ border: "none", background: "linear-gradient(135deg, #1677ff 0%, #13c2c2 55%, #52c41a 100%)", fontWeight: 600, fontSize: 11, height: 22, padding: "0 10px" }}
        >
          Ask VERA
        </Button>
      </span>
    </div>
  );
}

export default memo(VeraCard);
