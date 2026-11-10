import { Form, Tag, Tooltip, Typography } from "antd";
import { CheckCircleFilled } from "@ant-design/icons";

const { Text } = Typography;

// Ready-made colour templates for Theme & Appearance. Choosing one fills every
// colour field below it (primary, sider light/dark, header light/dark and the
// sidebar style) so the admin starts from a coordinated palette and fine-tunes
// from there. Nothing is applied until Save Settings — same as editing the fields
// by hand. The light/dark MODE is deliberately left alone: a template is a palette,
// not a mode.
//
// Headers stay white in light mode on every template: the header carries the
// page title and actions, and a coloured header behind dark text is what made
// custom themes hard to read.
const THEME_TEMPLATES = [
  {
    key: "emb-navy",
    name: "EMB Navy",
    note: "Default",
    primaryColor: "#1a3353",
    sidebarStyle: "gradient",
    siderColor: "#1a3353",
    siderColorDark: "#111927",
    headerColor: "#ffffff",
    headerColorDark: "#141414",
  },
  {
    key: "ocean",
    name: "Ocean Blue",
    primaryColor: "#1677ff",
    sidebarStyle: "gradient",
    siderColor: "#0b3d91",
    siderColorDark: "#0a1f44",
    headerColor: "#ffffff",
    headerColorDark: "#141414",
  },
  {
    key: "forest",
    name: "Forest Green",
    primaryColor: "#237804",
    sidebarStyle: "gradient",
    siderColor: "#135200",
    siderColorDark: "#0b2a05",
    headerColor: "#ffffff",
    headerColorDark: "#141414",
  },
  {
    key: "teal",
    name: "Coastal Teal",
    primaryColor: "#08979c",
    sidebarStyle: "solid",
    siderColor: "#00474f",
    siderColorDark: "#062a2e",
    headerColor: "#ffffff",
    headerColorDark: "#141414",
  },
  {
    key: "purple",
    name: "Royal Purple",
    primaryColor: "#531dab",
    sidebarStyle: "gradient",
    siderColor: "#22075e",
    siderColorDark: "#160436",
    headerColor: "#ffffff",
    headerColorDark: "#141414",
  },
  {
    key: "maroon",
    name: "Maroon",
    primaryColor: "#a8071a",
    sidebarStyle: "solid",
    siderColor: "#5c0011",
    siderColorDark: "#2a0008",
    headerColor: "#ffffff",
    headerColorDark: "#141414",
  },
  {
    key: "amber",
    name: "Sunset Amber",
    primaryColor: "#d46b08",
    sidebarStyle: "gradient",
    siderColor: "#612500",
    siderColorDark: "#2b1100",
    headerColor: "#ffffff",
    headerColorDark: "#141414",
  },
  {
    key: "graphite",
    name: "Graphite",
    primaryColor: "#434343",
    sidebarStyle: "solid",
    siderColor: "#262626",
    siderColorDark: "#0f0f0f",
    headerColor: "#ffffff",
    headerColorDark: "#141414",
  },
];

const FIELDS = ["primaryColor", "sidebarStyle", "siderColor", "siderColorDark", "headerColor", "headerColorDark"];
const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

function Preview({ t }) {
  const sider =
    t.sidebarStyle === "gradient"
      ? `linear-gradient(180deg, ${t.siderColor} 0%, ${t.siderColorDark} 100%)`
      : t.siderColor;
  return (
    <div
      style={{
        display: "flex",
        height: 58,
        borderRadius: 6,
        overflow: "hidden",
        border: "1px solid rgba(0,0,0,0.08)",
      }}
    >
      <div style={{ width: 22, background: sider }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#f5f7fa" }}>
        <div style={{ height: 14, background: t.headerColor, borderBottom: "1px solid rgba(0,0,0,0.06)" }} />
        <div style={{ flex: 1, padding: 6, display: "flex", gap: 4, alignItems: "flex-start" }}>
          <span style={{ width: 26, height: 10, borderRadius: 3, background: t.primaryColor }} />
          <span style={{ width: 18, height: 10, borderRadius: 3, background: "#d9d9d9" }} />
        </div>
      </div>
    </div>
  );
}

export default function ThemeColorTemplates({ form }) {
  const values = Form.useWatch([], form) || {};
  const activeKey = THEME_TEMPLATES.find((t) => FIELDS.every((k) => same(t[k], values[k])))?.key;

  const apply = (t) => {
    form.setFieldsValue(Object.fromEntries(FIELDS.map((k) => [k, t[k]])));
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <Text type="secondary" style={{ display: "block", fontSize: 12, marginBottom: 8 }}>
        Color templates — pick one to fill the colors below, then adjust any field. Applied when you
        click <b>Save Settings</b>.
      </Text>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 10,
        }}
      >
        {THEME_TEMPLATES.map((t) => {
          const active = activeKey === t.key;
          return (
            <Tooltip key={t.key} title={`Use the ${t.name} palette`}>
              <button
                type="button"
                onClick={() => apply(t)}
                aria-pressed={active}
                style={{
                  textAlign: "left",
                  cursor: "pointer",
                  padding: 8,
                  borderRadius: 8,
                  background: "#fff",
                  border: active ? `2px solid ${t.primaryColor}` : "1px solid #e3e9f2",
                  boxShadow: active ? `0 0 0 3px ${t.primaryColor}22` : "none",
                  transition: "box-shadow .15s, border-color .15s",
                }}
              >
                <Preview t={t} />
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <Text strong style={{ fontSize: 12 }}>
                    {t.name}
                  </Text>
                  {t.note && (
                    <Tag style={{ fontSize: 10, marginInlineEnd: 0, lineHeight: "16px" }}>{t.note}</Tag>
                  )}
                  {active && <CheckCircleFilled style={{ color: t.primaryColor, marginLeft: "auto" }} />}
                </div>
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
