import { useEffect, useState } from "react";
import { Typography } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";

const { Text } = Typography;

// Philippine time, like every "today" in this app (server/utils/appTime.js).
const TIME_ZONE = "Asia/Manila";
const FULL = new Intl.DateTimeFormat("en-PH", {
  timeZone: TIME_ZONE,
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const SHORT = new Intl.DateTimeFormat("en-PH", {
  timeZone: TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
});
const TIME = new Intl.DateTimeFormat("en-PH", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

// Day, date and time in the portal header. Its own component so the once-a-
// minute tick re-renders this line only, never the whole portal.
export default function HeaderClock({ compact = false }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let interval;
    // Tick on the minute boundary, then every minute.
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60000);
    }, 60000 - (Date.now() % 60000));
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);

  return (
    <Text
      className="portal-header-clock"
      style={{ color: "#1a3353", fontSize: compact ? 12 : 13, whiteSpace: "nowrap" }}
      aria-live="off"
    >
      <ClockCircleOutlined style={{ marginRight: 6, color: "#2d5f8a" }} />
      <time dateTime={now.toISOString()}>
        {compact ? SHORT.format(now) : FULL.format(now)}
        <Text strong style={{ color: "#1a3353", marginLeft: 8, fontSize: "inherit" }}>
          {TIME.format(now)}
        </Text>
      </time>
    </Text>
  );
}
