import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  Avatar,
  Tooltip,
  Modal,
  List,
  Tag,
  Typography,
  Empty,
  Spin,
  Space,
  Badge,
  Segmented,
  Button,
} from "antd";
import {
  CalendarOutlined,
  CarOutlined,
  LeftOutlined,
  RightOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import api from "../../api";
import { normalizeUnit } from "../../utils/volumeUnits";

const { Text } = Typography;

// Deterministic avatar colour per user so the same person keeps one colour across
// every day cell.
const AVATAR_COLORS = [
  "#1677ff", "#52c41a", "#fa8c16", "#722ed1",
  "#13c2c2", "#eb2f96", "#faad14", "#2f54eb",
];
const colorFor = (key) => {
  const s = String(key || "");
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
};
const initialsOf = (name) =>
  String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";

// #7: show the disposed volume in the record's single declared baseline unit,
// never "m³ / tons" side-by-side. Both figures are kept in lockstep upstream.
const recVolume = (record) => {
  const unit = normalizeUnit(record.baselineUnit) || "m³";
  const value =
    unit === "tons"
      ? Number(record.totalVolumeTons || 0)
      : Number(record.totalVolumeM3 || 0);
  return value ? `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}` : "—";
};

// ── Daily Disposal Activity Calendar ──
// Reads actual disposal records (/data-slf) and portal accounts (/portal-users),
// matched by submitter email, and shows the portal users who disposed on each
// date as avatars. Defaults to a compact WEEKLY strip (#3) with a Week/Month
// toggle; clicking a day opens that day's records. Portal accounts carry no
// profile image, so avatars are initials-based fallbacks.
export default function DisposalActivityCalendar({ isDark }) {
  const [records, setRecords] = useState([]);
  const [userByEmail, setUserByEmail] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(null);
  const [cursor, setCursor] = useState(dayjs());
  // #3: weekly view by default; the month grid stays available via the toggle.
  const [viewMode, setViewMode] = useState("week");
  const [weekStart, setWeekStart] = useState(dayjs().startOf("week"));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [recRes, userRes] = await Promise.all([
          api.get("/data-slf", { params: { mode: "list", includeTrucks: true } }),
          api.get("/portal-users").catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        const recData = recRes.data;
        const recs = Array.isArray(recData?.data)
          ? recData.data
          : Array.isArray(recData)
            ? recData
            : [];
        const withDate = recs.filter((r) => r.dateOfDisposal);
        setRecords(withDate);
        const map = {};
        (userRes.data || []).forEach((u) => {
          const email = String(u.email || "").trim().toLowerCase();
          if (email) {
            map[email] = {
              name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || email,
              email: u.email,
              company: u.companyName || "",
            };
          }
        });
        setUserByEmail(map);
        // Jump to the most recent disposal so neither view opens on an empty span.
        const latest = withDate.reduce((acc, r) => {
          const d = dayjs(r.dateOfDisposal);
          return d.isAfter(acc) ? d : acc;
        }, dayjs("1970-01-01"));
        if (latest.isAfter(dayjs("1970-01-01"))) {
          setCursor(latest);
          setWeekStart(latest.startOf("week"));
        }
      } catch {
        if (!cancelled) setRecords([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // date (YYYY-MM-DD) → { users: [{key,name,company,count}], records: [] }
  const dayMap = useMemo(() => {
    const map = {};
    records.forEach((record) => {
      const key = dayjs(record.dateOfDisposal).format("YYYY-MM-DD");
      if (!map[key]) map[key] = { userMap: {}, records: [] };
      map[key].records.push(record);
      const email = String(record.submittedBy || "").trim().toLowerCase();
      const known = userByEmail[email];
      const uKey = email || record.submittedBy || record.lguCompanyName || "unknown";
      const name = known?.name || record.submittedBy || record.lguCompanyName || "Unknown user";
      if (!map[key].userMap[uKey]) {
        map[key].userMap[uKey] = {
          key: uKey,
          name,
          company: known?.company || record.lguCompanyName || "",
          count: 0,
        };
      }
      map[key].userMap[uKey].count += 1;
    });
    Object.values(map).forEach((d) => {
      d.users = Object.values(d.userMap).sort((a, b) => b.count - a.count);
    });
    return map;
  }, [records, userByEmail]);

  const dayData = (value) => dayMap[value.format("YYYY-MM-DD")];

  const renderAvatars = (users, size) => (
    <Avatar.Group
      max={{ count: 3, style: { backgroundColor: "#8c8c8c", fontSize: size === "small" ? 10 : 13 } }}
      size={size === "small" ? 20 : 28}
    >
      {users.map((u) => (
        <Tooltip
          key={u.key}
          title={`${u.name}${u.company ? ` — ${u.company}` : ""} · ${u.count} record(s)`}
        >
          <Avatar
            size={size === "small" ? 20 : 28}
            style={{ backgroundColor: colorFor(u.key), fontSize: size === "small" ? 9 : 12 }}
          >
            {initialsOf(u.name)}
          </Avatar>
        </Tooltip>
      ))}
    </Avatar.Group>
  );

  const cellRender = (current, info) => {
    if (info.type !== "date") return info.originNode;
    const data = dayData(current);
    if (!data) return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        {renderAvatars(data.users, "small")}
        <Text type="secondary" style={{ fontSize: 10 }}>
          {data.records.length} record{data.records.length !== 1 ? "s" : ""}
        </Text>
      </div>
    );
  };

  // ── Weekly strip (default) ──
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => weekStart.add(i, "day")),
    [weekStart],
  );

  const openDay = (date) => {
    setCursor(date);
    if (dayData(date)) setSelectedDate(date);
  };

  const border = isDark ? "#303030" : "#f0f0f0";

  const renderWeekStrip = () => (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <Space size={4}>
          <Button size="small" icon={<LeftOutlined />} onClick={() => setWeekStart((w) => w.subtract(7, "day"))} />
          <Button size="small" onClick={() => setWeekStart(dayjs().startOf("week"))}>This week</Button>
          <Button size="small" icon={<RightOutlined />} onClick={() => setWeekStart((w) => w.add(7, "day"))} />
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {weekStart.format("MMM D")} – {weekStart.add(6, "day").format("MMM D, YYYY")}
        </Text>
      </div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
        {weekDays.map((d) => {
          const data = dayData(d);
          const isToday = d.isSame(dayjs(), "day");
          return (
            <div
              key={d.format("YYYY-MM-DD")}
              onClick={() => data && openDay(d)}
              style={{
                flex: "1 1 0",
                minWidth: 46,
                border: `1px solid ${isToday ? "#1677ff" : border}`,
                borderRadius: 8,
                padding: "6px 4px 8px",
                textAlign: "center",
                cursor: data ? "pointer" : "default",
                background: data ? (isDark ? "rgba(22,119,255,0.12)" : "#f0f7ff") : "transparent",
                minHeight: 92,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                transition: "background 0.2s",
              }}
            >
              <Text type="secondary" style={{ fontSize: 10, textTransform: "uppercase" }}>
                {d.format("ddd")}
              </Text>
              <Text strong style={{ fontSize: 14, color: isToday ? "#1677ff" : undefined }}>
                {d.format("D")}
              </Text>
              {data ? (
                <>
                  {renderAvatars(data.users, "small")}
                  <Text type="secondary" style={{ fontSize: 9 }}>
                    {data.records.length} rec{data.records.length !== 1 ? "s" : ""}
                  </Text>
                </>
              ) : (
                <Text type="secondary" style={{ fontSize: 9, opacity: 0.5 }}>—</Text>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const selected = selectedDate ? dayData(selectedDate) : null;

  return (
    <div
      style={{
        background: isDark ? "transparent" : "#fff",
        borderRadius: 10,
        border: `1px solid ${border}`,
        padding: 8,
      }}
    >
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <Spin />
          <div style={{ marginTop: 12 }}>
            <Text type="secondary">Loading daily disposal activity…</Text>
          </div>
        </div>
      ) : records.length === 0 ? (
        <Empty description="No disposal records with dates yet." style={{ padding: "32px 0" }} />
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <Segmented
              size="small"
              value={viewMode}
              onChange={setViewMode}
              options={[
                { label: "Week", value: "week" },
                { label: "Month", value: "month" },
              ]}
            />
          </div>
          {viewMode === "week" ? (
            renderWeekStrip()
          ) : (
            <Calendar
              value={cursor}
              onPanelChange={(v) => setCursor(v)}
              cellRender={cellRender}
              onSelect={(date, info) => {
                if (info?.source === "date" || !info) {
                  setCursor(date);
                  if (dayData(date)) setSelectedDate(date);
                }
              }}
            />
          )}
        </>
      )}

      <Modal
        open={!!selectedDate && !!selected}
        onCancel={() => setSelectedDate(null)}
        footer={null}
        width={620}
        title={
          <Space>
            <CalendarOutlined style={{ color: "#1677ff" }} />
            <span>
              Disposal Activity — {selectedDate ? selectedDate.format("MMMM D, YYYY") : ""}
            </span>
          </Space>
        }
        styles={{ body: { maxHeight: "68vh", overflowY: "auto" } }}
      >
        {selected && (
          <>
            <Space wrap style={{ marginBottom: 12 }}>
              <Badge count={selected.records.length} color="#1677ff" />
              <Text type="secondary">
                {selected.users.length} portal user(s) · {selected.records.length} record(s)
              </Text>
              {renderAvatars(selected.users, "default")}
            </Space>
            <List
              size="small"
              dataSource={selected.records}
              rowKey={(r) => r._id || `${r.slfName}-${r.dateOfDisposal}-${Math.random()}`}
              renderItem={(record) => {
                const email = String(record.submittedBy || "").trim().toLowerCase();
                const user = userByEmail[email];
                const name = user?.name || record.submittedBy || "Unknown user";
                const uKey = email || record.submittedBy || record.lguCompanyName || "unknown";
                return (
                  <List.Item>
                    <List.Item.Meta
                      avatar={
                        <Avatar style={{ backgroundColor: colorFor(uKey) }}>
                          {initialsOf(name)}
                        </Avatar>
                      }
                      title={
                        <Space wrap size={6}>
                          <Text strong style={{ fontSize: 13 }}>
                            {record.slfName || record.lguCompanyName || "—"}
                          </Text>
                          <Tag color="blue" style={{ margin: 0 }}>
                            <CarOutlined /> {record.truckCount ?? record.trucks?.length ?? 0} truck(s)
                          </Tag>
                        </Space>
                      }
                      description={
                        <span style={{ fontSize: 12 }}>
                          By {name}
                          {user?.company ? ` · ${user.company}` : ""} · {recVolume(record)}
                        </span>
                      }
                    />
                  </List.Item>
                );
              }}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
