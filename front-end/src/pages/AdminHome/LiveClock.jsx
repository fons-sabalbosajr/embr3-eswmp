import { useState, useEffect } from "react";
import { Typography } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

const { Text } = Typography;

// Self-contained live clock. Owns its own 1s ticking state so the once-per-second
// update re-renders ONLY this tiny node — not the entire AdminHome dashboard
// (10k+ lines of tabs, charts and maps). Previously the tick lived in AdminHome
// state and forced a full-tree re-render every second (a major idle CPU / GC and
// memory-churn source over a long session).
export default function LiveClock({ isDark }) {
  const [now, setNow] = useState(dayjs());
  useEffect(() => {
    const timer = setInterval(() => setNow(dayjs()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div
      className="admin-clock"
      style={{ display: "flex", alignItems: "center", marginRight: 16, gap: 6 }}
    >
      <ClockCircleOutlined style={{ fontSize: 14, color: isDark ? "#999" : "#888" }} />
      <Text style={{ fontSize: 13, color: isDark ? "#ccc" : "#666", whiteSpace: "nowrap" }}>
        {now.format("ddd, MMM DD YYYY — h:mm:ss A")}
      </Text>
    </div>
  );
}
