// Inline style objects + color math for the AdminHome shell (sider/header/content
// layout). Pure — no React, no component state. Extracted from index.jsx.

// Lighten / darken a hex color by `amount` (positive = lighten)
function adjustBrightness(hex, amount) {
  let c = hex.replace("#", "");
  if (c.length === 3)
    c = c
      .split("")
      .map((ch) => ch + ch)
      .join("");
  const num = parseInt(c, 16);
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function getStyles(isDark, opts = {}) {
  const {
    siderColor = "#1a3353",
    siderColorDark = "#111927",
    headerColor = "#ffffff",
    headerColorDark = "#141414",
    sidebarStyle = "gradient",
  } = opts;

  const baseSider = isDark ? siderColorDark : siderColor;
  const siderBg =
    sidebarStyle === "gradient"
      ? `linear-gradient(180deg, ${baseSider} 0%, ${adjustBrightness(baseSider, 30)} 100%)`
      : baseSider;

  return {
    sider: {
      background: siderBg,
      boxShadow: "2px 0 8px rgba(0,0,0,0.15)",
      display: "flex",
      flexDirection: "column",
    },
    logo: {
      height: 64,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
    },
    logoText: {
      color: "#fff",
      margin: 0,
      fontWeight: 600,
      letterSpacing: 1,
    },
    siderFooter: {
      padding: "12px 16px",
      textAlign: "center",
      borderTop: "1px solid rgba(255,255,255,0.06)",
    },
    header: {
      background: isDark ? headerColorDark : headerColor,
      padding: "0 24px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      boxShadow: isDark
        ? "0 1px 4px rgba(0,0,0,0.3)"
        : "0 1px 4px rgba(0,0,0,0.06)",
      position: "sticky",
      top: 0,
      zIndex: 10,
    },
    headerRight: {
      display: "flex",
      alignItems: "center",
    },
    userInfo: {
      display: "flex",
      alignItems: "center",
      cursor: "pointer",
      padding: "4px 8px",
      borderRadius: 8,
    },
    content: {
      margin: 24,
      padding: 24,
      background: isDark ? "#1f1f1f" : "#f0f2f5",
      minHeight: 280,
      flex: "1 0 auto",
    },
    footer: {
      textAlign: "center",
      padding: "16px 24px",
      background: isDark ? "#141414" : "#fff",
      borderTop: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
    },
  };
}
