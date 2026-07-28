// Dedicated VERA notification bell for the Admin Portal header — SEPARATE from the
// standard notification bell (its own flame icon + dropdown container). Surfaces
// deterministic, sanitized VERA findings (LGU reconciliation, data-quality,
// provider health) from GET /vera/notifications. Unread state is tracked per user
// via a localStorage signature of the current findings, so the badge only lights
// up when the finding set changes. Never blocks the header if retrieval fails.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Popover, Badge, Button, List, Empty, Tag, Typography, Space, Spin, Tooltip } from "antd";
import dayjs from "dayjs";
import VeraFlameIcon from "../../components/VeraFlameIcon";
import api from "../../api";

const { Text } = Typography;

const SEVERITY = {
  critical: { color: "red", label: "Critical" },
  warning: { color: "orange", label: "Warning" },
  recommendation: { color: "blue", label: "Recommendation" },
  informational: { color: "default", label: "Info" },
};

const seenKey = (userId) => `vera_notif_seen_${userId || "admin"}`;

const headerIconButtonStyle = (isDark, open) => ({
  width: 32,
  height: 32,
  minWidth: 32,
  padding: 0,
  borderRadius: 8,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: isDark ? "#999" : "#666",
  background: open ? (isDark ? "rgba(255,255,255,0.08)" : "#f5f5f5") : undefined,
  marginRight: 12,
  verticalAlign: "middle",
});

export default function VeraNotificationBell({ isDark, userId }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [seenSig, setSeenSig] = useState(() => {
    try { return localStorage.getItem(seenKey(userId)) || ""; } catch { return ""; }
  });

  const sig = useMemo(() => items.map((i) => i.id).join("|"), [items]);
  // Unread = number of findings while the current finding-set hasn't been marked seen.
  const unread = sig && sig !== seenSig ? items.length : 0;

  const fetchFeed = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/vera/notifications");
      const list = Array.isArray(data?.items) ? data.items : [];
      // Defensive: always present latest first (newest createdAt on top),
      // consistent with every other notification view.
      list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      setItems(list);
    } catch { /* non-blocking */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchFeed();
    const id = setInterval(() => { if (!document.hidden) fetchFeed(); }, 120000);
    return () => clearInterval(id);
  }, [fetchFeed]);

  const markAllRead = useCallback(() => {
    setSeenSig(sig);
    try { localStorage.setItem(seenKey(userId), sig); } catch { /* ignore */ }
  }, [sig, userId]);

  const onItemClick = (n) => {
    // Universal action: open VERA so the admin can ask about the finding. The
    // message text also names the exact destination (e.g. LGUs Served → Reconcile).
    window.dispatchEvent(new CustomEvent("vera:open"));
    setOpen(false);
  };

  const content = (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px 10px", borderBottom: isDark ? "1px solid #303030" : "1px solid #f0f0f0" }}>
        <Space size={8}><VeraFlameIcon size={18} animated={false} /><Text strong style={{ fontSize: 15 }}>VERA Notifications</Text></Space>
        {unread > 0 && <Button type="link" size="small" onClick={markAllRead} style={{ fontSize: 12, padding: 0 }}>Mark all as read</Button>}
      </div>
      <div style={{ maxHeight: 420, overflowY: "auto" }}>
        {loading && items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}><Spin size="small" /></div>
        ) : items.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No VERA notifications" style={{ padding: "40px 0" }} />
        ) : (
          <List
            dataSource={items}
            renderItem={(n) => {
              const sev = SEVERITY[n.severity] || SEVERITY.informational;
              return (
                <div
                  key={n.id}
                  onClick={() => onItemClick(n)}
                  style={{ display: "flex", gap: 12, padding: "12px 16px", cursor: "pointer", borderBottom: isDark ? "1px solid #303030" : "1px solid #f5f5f5" }}
                >
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: isDark ? "#0f1a2b" : "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <VeraFlameIcon size={18} animated={false} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <Text strong style={{ fontSize: 13, lineHeight: 1.3 }}>{n.title}</Text>
                      <Tag color={sev.color} style={{ margin: 0, fontSize: 10 }}>{sev.label}</Tag>
                    </div>
                    {(n.sourceModule || n.status) && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "3px 0 1px" }}>
                        {n.sourceModule && <Tag style={{ margin: 0, fontSize: 10 }}>{n.sourceModule}</Tag>}
                        {n.status && <Tag color={n.status === "resolved" ? "green" : "default"} style={{ margin: 0, fontSize: 10 }}>{n.status}</Tag>}
                      </div>
                    )}
                    <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{n.message}</Text>
                    {(n.affectedUser || n.affectedSlf) && (
                      <Text type="secondary" style={{ fontSize: 11, marginTop: 2, display: "block" }}>
                        Affected: {[n.affectedSlf, n.affectedUser].filter(Boolean).join(" · ")}
                      </Text>
                    )}
                    {n.recommendedAction && (
                      <Text style={{ fontSize: 11, marginTop: 2, display: "block", color: isDark ? "#69b1ff" : "#1677ff" }}>
                        → {n.recommendedAction}
                      </Text>
                    )}
                    <Text type="secondary" style={{ fontSize: 11, marginTop: 2, display: "block" }}>{n.createdAt ? dayjs(n.createdAt).fromNow() : ""}</Text>
                  </div>
                </div>
              );
            }}
          />
        )}
      </div>
      <div style={{ padding: 10, borderTop: isDark ? "1px solid #303030" : "1px solid #f0f0f0", textAlign: "center" }}>
        <Button type="link" block onClick={() => { window.dispatchEvent(new CustomEvent("vera:open")); setOpen(false); }}>
          Ask VERA about these
        </Button>
      </div>
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(o) => { setOpen(o); if (o) fetchFeed(); }}
      trigger="click"
      placement="bottomRight"
      arrow={false}
      overlayInnerStyle={{ padding: 0, borderRadius: 12, overflow: "hidden" }}
      overlayStyle={{ width: "min(380px, 94vw)" }}
      content={content}
    >
      <Tooltip title={`${unread} unread VERA notification${unread === 1 ? "" : "s"}`}>
        <Badge
          count={unread}
          size="small"
          overflowCount={99}
          offset={[-6, 6]}
          style={{ backgroundColor: "#13c2c2", boxShadow: isDark ? "0 0 0 2px #141414" : "0 0 0 2px #fff", fontSize: 10, lineHeight: "16px", height: 16, minWidth: 16, padding: "0 4px" }}
        >
          <Button
            type="text"
            aria-label={`${unread} unread VERA notifications`}
            icon={<span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 0 }}><VeraFlameIcon size={24} /></span>}
            style={headerIconButtonStyle(isDark, open)}
          />
        </Badge>
      </Tooltip>
    </Popover>
  );
}
