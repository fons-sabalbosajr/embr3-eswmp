import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Calendar,
  Avatar,
  Tooltip,
  Modal,
  Tag,
  Typography,
  Empty,
  Spin,
  Space,
  Badge,
  Segmented,
  Button,
  Select,
  Table,
  Skeleton,
  Collapse,
} from "antd";
import {
  CalendarOutlined,
  CarOutlined,
  LeftOutlined,
  RightOutlined,
  UserOutlined,
  BankOutlined,
  InboxOutlined,
  ClockCircleOutlined,
  ExportOutlined,
  RedoOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import api from "../../api";
import { classifySlfStatus, presentationFor } from "../../utils/submissionStatus";
import { getSocket } from "../../utils/socket";
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

const DISPOSAL_STATUS_META = {
  acknowledged: { label: "", color: "success", icon: <CheckCircleOutlined /> },
  approved: { label: "", color: "success", icon: <CheckCircleOutlined /> },
  completed: { label: "", color: "success", icon: <CheckCircleOutlined /> },
  resubmitted: { label: "", color: "orange", icon: <RedoOutlined /> },
  pending: { label: "", color: "gold", icon: <ClockCircleOutlined /> },
  reverted: { label: "", color: "volcano", icon: <RedoOutlined /> },
  revert_requested: { label: "", color: "volcano", icon: <RedoOutlined /> },
  rejected: { label: "", color: "error", icon: <CloseCircleOutlined /> },
};
const statusMeta = (key) => DISPOSAL_STATUS_META[key] || { label: key || "Unknown", color: "default", icon: null };

export default function DisposalActivityCalendar({ isDark, height, onOpenSubmissions, canOpenSubmissions = false, selectedDate: mapDate, onSelectDate }) {
  const [records, setRecords] = useState([]);
  const [userByEmail, setUserByEmail] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [selectedDate, setSelectedDate] = useState(null);
  const [modalPreparing, setModalPreparing] = useState(false);
  const [cursor, setCursor] = useState(dayjs());
  // Month grid by default (Week strip stays available via the toggle).
  const [viewMode, setViewMode] = useState("month");
  const [weekStart, setWeekStart] = useState(dayjs().startOf("week"));
  const [filterUser, setFilterUser] = useState(null);
  const [filterSlf, setFilterSlf] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [recRes, userRes] = await Promise.all([
          api.get("/data-slf", {
            params: {
              mode: "list",
              includeTrucks: true,
              // Reverted / revert-requested submissions are pulled back and must not
              // appear as active disposal activity. Excluded at the query layer so
              // refreshing never resurfaces a stale reverted record.
              excludeStatuses: "reverted,revert_requested",
            },
          }),
          api.get("/portal-users").catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        const recData = recRes.data;
        const recs = Array.isArray(recData?.data)
          ? recData.data
          : Array.isArray(recData)
            ? recData
            : [];
        // Defensive client-side guard mirroring the server exclusion, in case a
        // cached/older response slips through.
        const isReverted = (s) => /revert/i.test(String(s || ""));
        const withDate = recs.filter((r) => r.dateOfDisposal && !isReverted(r.status));
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
  }, [refreshTick]);

  // Re-fetch (calendar + dropdown status icons stay in sync) when a submission is
  // acknowledged/reverted/rejected/restored elsewhere — no full dashboard reload.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onRefresh = ({ target } = {}) => {
      if (["submissions", "slf-waste-generators", "baselines"].includes(target)) setRefreshTick((t) => t + 1);
    };
    socket.on("data-refresh", onRefresh);
    return () => socket.off("data-refresh", onRefresh);
  }, []);

  // Portal-user + SLF filter option lists, derived from the loaded records.
  const userOptions = useMemo(() => {
    const seen = new Map();
    records.forEach((r) => {
      const email = String(r.submittedBy || "").trim().toLowerCase();
      if (!email || seen.has(email)) return;
      seen.set(email, userByEmail[email]?.name || r.submittedBy);
    });
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => String(a.label).localeCompare(String(b.label)));
  }, [records, userByEmail]);

  // Per-SLF classified submission status (shared rule) for the relevant date —
  // the selected calendar day when one is open, otherwise across all records.
  const slfStatusByName = useMemo(() => {
    const scope = selectedDate
      ? records.filter((r) => dayjs(r.dateOfDisposal).isSame(selectedDate, "day"))
      : records;
    const byName = {};
    scope.forEach((r) => {
      const n = r.slfName || r.lguCompanyName;
      if (!n) return;
      (byName[n] = byName[n] || []).push(r.status);
    });
    const out = {};
    Object.entries(byName).forEach(([n, statuses]) => { out[n] = classifySlfStatus(statuses); });
    return out;
  }, [records, selectedDate]);

  const slfOptions = useMemo(() => {
    const seen = new Set();
    records.forEach((r) => {
      const n = r.slfName || r.lguCompanyName;
      if (n) seen.add(n);
    });
    return [...seen].sort().map((v) => {
      const meta = presentationFor(slfStatusByName[v] || "none");
      const Icon = meta.icon;
      return {
        value: v,
        // JSX label: name (left, ellipsis) + status icon pinned right. Filtering
        // uses the option value (see the Select's filterOption).
        label: (
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v}>{v}</span>
            <Tooltip title={meta.label}>
              <Icon aria-label={meta.label} style={{ color: meta.color, flexShrink: 0 }} />
            </Tooltip>
          </div>
        ),
      };
    });
  }, [records, slfStatusByName]);

  // Records after applying the active filters — the calendar and day modal both
  // read from here so filters take effect without refetching.
  const filteredRecords = useMemo(
    () =>
      records.filter((r) => {
        if (
          filterUser &&
          String(r.submittedBy || "").trim().toLowerCase() !== filterUser
        )
          return false;
        if (filterSlf && (r.slfName || r.lguCompanyName) !== filterSlf) return false;
        return true;
      }),
    [records, filterUser, filterSlf],
  );

  // date (YYYY-MM-DD) → { users: [{key,name,company,count}], records: [] }
  const dayMap = useMemo(() => {
    const map = {};
    filteredRecords.forEach((record) => {
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
          count: 0, pending: 0, approved: 0, rejected: 0,
        };
      }
      const u = map[key].userMap[uKey];
      u.count += 1;
      const s = String(record.status || "").toLowerCase();
      if (s === "pending") u.pending += 1;
      else if (s === "rejected") u.rejected += 1;
      else u.approved += 1; // acknowledged / legacy
    });
    // A pending submission is a RESUBMISSION when it carries prior idNo(s)
    // (previously reverted, resubmitted). Distinguished from a pending INITIAL
    // submission so the calendar cell can flag them separately.
    const isPendingResub = (r) =>
      String(r.status || "").toLowerCase() === "pending" &&
      Array.isArray(r.previousIdNos) && r.previousIdNos.length > 0;
    Object.values(map).forEach((d) => {
      d.users = Object.values(d.userMap)
        // A user's avatar is "pending" only when ALL of their records that day are
        // still pending (mixed days show the active style + a day pending badge).
        .map((u) => ({ ...u, isPending: u.pending > 0 && u.approved === 0 && u.rejected === 0 }))
        .sort((a, b) => b.count - a.count);
      d.resubmissionCount = d.records.filter(isPendingResub).length;
      d.pendingCount = d.records.filter(
        (r) => String(r.status || "").toLowerCase() === "pending" && !isPendingResub(r),
      ).length;
      d.acknowledgedCount = d.records.filter(
        (r) => !["pending", "rejected", "reverted", "revert_requested"].includes(String(r.status || "").toLowerCase()),
      ).length;
    });
    return map;
  }, [filteredRecords, userByEmail]);

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
      <div className="slf-cal-cell">
        <Avatar.Group
          max={{ count: 2, style: { backgroundColor: "#8c8c8c", fontSize: 9, width: 18, height: 18, lineHeight: "18px" } }}
          size={18}
        >
          {data.users.map((u) => (
            <Tooltip key={u.key} title={`${u.name}${u.company ? ` — ${u.company}` : ""} · ${u.count} record(s)${u.isPending ? " · Pending" : ""}`}>
              <Avatar
                size={18}
                className={u.isPending ? "slf-pending-avatar" : undefined}
                style={{ backgroundColor: colorFor(u.key), fontSize: 8, opacity: u.isPending ? 0.7 : 1 }}
              >
                {initialsOf(u.name)}
              </Avatar>
            </Tooltip>
          ))}
        </Avatar.Group>
        <span className="slf-cal-count">
          {data.records.length} rec{data.records.length !== 1 ? "s" : ""}
        </span>
        {/* Item #6: all status counts on ONE horizontal row (icons + counts),
            no line breaks; scrolls horizontally within the cell if it overflows
            so it never wraps or overlaps adjacent day cells. */}
        {(data.resubmissionCount > 0 || data.pendingCount > 0 || data.acknowledgedCount > 0) && (
          <div className="slf-cal-statusrow">
            {data.resubmissionCount > 0 && (
              <Tooltip title={`${data.resubmissionCount} pending resubmission${data.resubmissionCount === 1 ? "" : "s"} awaiting review`}>
                <span className="slf-cal-resub" aria-label={`${data.resubmissionCount} pending resubmission`}>
                  <RedoOutlined /> {data.resubmissionCount}
                </span>
              </Tooltip>
            )}
            {data.pendingCount > 0 && (
              <Tooltip title={`${data.pendingCount} pending initial submission${data.pendingCount === 1 ? "" : "s"} awaiting review`}>
                <span className="slf-cal-pending" aria-label={`${data.pendingCount} pending`}>
                  <ClockCircleOutlined /> {data.pendingCount}
                </span>
              </Tooltip>
            )}
            {data.acknowledgedCount > 0 && (
              <Tooltip title={`${data.acknowledgedCount} acknowledged submission${data.acknowledgedCount === 1 ? "" : "s"}`}>
                <span className="slf-cal-ack" aria-label={`${data.acknowledgedCount} acknowledged`}>
                  <CheckCircleOutlined /> {data.acknowledgedCount}
                </span>
              </Tooltip>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Weekly strip (default) ──
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => weekStart.add(i, "day")),
    [weekStart],
  );

  // Single day-click entry point: set the visible month, tell the parent so the
  // SLF map updates to THIS date (even when the day has no activity → neutral
  // markers), and open the day-detail modal when there are records.
  const openDay = (date) => {
    setCursor(date);
    if (onSelectDate) onSelectDate(date);
    if (dayData(date)) setSelectedDate(date);
  };

  const border = isDark ? "#303030" : "#f0f0f0";

  // ── Year view ── 12-month summary grid for the visible year (cursor). Each
  // month card aggregates the actual statuses from the loaded records; clicking a
  // month opens that month. Counts are only shown for months that have data, so
  // empty months never display misleading totals.
  const yearMonths = useMemo(() => {
    const year = cursor.year();
    const buckets = Array.from({ length: 12 }, (_, m) => ({
      m,
      label: dayjs(new Date(year, m, 1)).format("MMM"),
      submissions: 0,
      acknowledged: 0,
      pending: 0,
      reverted: 0,
      rejected: 0,
      slfs: new Set(),
    }));
    filteredRecords.forEach((r) => {
      const d = dayjs(r.dateOfDisposal);
      if (!d.isValid() || d.year() !== year) return;
      const b = buckets[d.month()];
      b.submissions += 1;
      b.slfs.add(r.slfName || r.lguCompanyName || "");
      const s = String(r.status || "").toLowerCase();
      if (s.includes("acknowledg") || s === "approved" || s === "accepted" || s === "completed") b.acknowledged += 1;
      else if (s.includes("reject")) b.rejected += 1;
      else if (s.includes("revert")) b.reverted += 1;
      else b.pending += 1;
    });
    return buckets.map((b) => ({ ...b, slfCount: b.slfs.size }));
  }, [filteredRecords, cursor]);

  const renderYearGrid = () => {
    const chip = (label, n, color) =>
      n > 0 ? (
        <Tooltip key={label} title={`${n} ${label}`}>
          <Tag color={color} style={{ margin: "1px 2px 0 0", fontSize: 10, padding: "0 5px" }}>{label[0]}:{n}</Tag>
        </Tooltip>
      ) : null;
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 10,
          padding: "4px 4px 8px",
        }}
      >
        {yearMonths.map((mo) => {
          const has = mo.submissions > 0;
          return (
            <div
              key={mo.m}
              role="button"
              tabIndex={0}
              aria-label={`${mo.label} ${cursor.year()} — ${mo.submissions} submissions`}
              onClick={() => { setCursor(cursor.month(mo.m)); setViewMode("month"); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCursor(cursor.month(mo.m)); setViewMode("month"); } }}
              style={{
                border: `1px solid ${border}`,
                borderRadius: 10,
                padding: "10px 12px",
                cursor: "pointer",
                background: has ? (isDark ? "rgba(24,144,255,0.08)" : "#f7fbff") : (isDark ? "transparent" : "#fafafa"),
                transition: "box-shadow .15s ease, transform .1s ease",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <Text strong style={{ fontSize: 14 }}>{mo.label}</Text>
                <Text type="secondary" style={{ fontSize: 11 }}>{mo.submissions || "—"}{mo.submissions ? " subm." : ""}</Text>
              </div>
              {has ? (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", marginTop: 4 }}>
                    {chip("Acknowledged", mo.acknowledged, "blue")}
                    {chip("Pending", mo.pending, "gold")}
                    {chip("Reverted", mo.reverted, "orange")}
                    {chip("Rejected", mo.rejected, "red")}
                  </div>
                  <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
                    {mo.slfCount} active SLF{mo.slfCount === 1 ? "" : "s"}
                  </Text>
                </>
              ) : (
                <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 6 }}>No activity</Text>
              )}
            </div>
          );
        })}
      </div>
    );
  };

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

  const buildDisposalRows = useCallback((recs) => {
    const rows = [];
    (recs || []).forEach((record) => {
      const email = String(record.submittedBy || "").trim().toLowerCase();
      const user = userByEmail[email]?.name || record.submittedBy || "Unknown user";
      const slf = record.slfName || record.lguCompanyName || "—";
      const slfId = record.slfGenerator && typeof record.slfGenerator === "object"
        ? String(record.slfGenerator._id || "")
        : record.slfGenerator ? String(record.slfGenerator) : "";
      const unit = normalizeUnit(record.baselineUnit) || "m³";
      const ref = record.idNo || record.submissionId || "—";
      const status = record.status || "—";
      const isResub = Array.isArray(record.previousIdNos) && record.previousIdNos.length > 0;
      const statusKey =
        String(status).toLowerCase() === "pending" && isResub
          ? "resubmitted"
          : String(status).toLowerCase();
      const trucks = Array.isArray(record.trucks) ? record.trucks : [];
      const fmtVol = (val, u) => {
        const n = Number(val || 0);
        return n > 0
          ? `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${u}`
          : "—";
      };
      if (!trucks.length) {
        const rv =
          unit === "tons"
            ? Number(record.totalVolumeTons || 0)
            : Number(record.totalVolumeM3 || 0);
        rows.push({
          key: `${record._id || ref}-r`,
          slf, slfId, user, submittedBy: record.submittedBy || "", ref, status, statusKey,
          date: record.dateOfDisposal || null,
          hauler: "—",
          client: "—", plate: "—", cell: "—", wasteType: "—",
          volume: recVolume(record),
          volumeNum: rv, volUnit: unit,
        });
        return;
      }
      trucks.forEach((truck, ti) => {
        const vehicles =
          Array.isArray(truck.vehicles) && truck.vehicles.length
            ? truck.vehicles
            : [truck];
        vehicles.forEach((v, vi) => {
          const clients = (v.selectedClients || truck.selectedClients || [])
            .map((c) => (typeof c === "object" ? c.clientName : c))
            .filter(Boolean);
          const vUnit = v.actualVolumeUnit ? normalizeUnit(v.actualVolumeUnit) : unit;
          rows.push({
            key: `${record._id || ref}-${ti}-${vi}`,
            slf, slfId, user, submittedBy: record.submittedBy || "", ref, status, statusKey,
            date: record.dateOfDisposal || null,
            // Hauler is recorded on the truck, not the vehicle.
            hauler: truck.hauler || truck.haulerName || "—",
            client: clients.length ? [...new Set(clients)].join(", ") : "—",
            plate: v.plateNumber || truck.plateNumber || "—",
            cell: v.cellName || truck.cellName || "—",
            wasteType: v.wasteType || truck.wasteType || "—",
            volume: fmtVol(v.actualVolume ?? truck.actualVolume, vUnit),
            volumeNum: Number(v.actualVolume ?? truck.actualVolume ?? 0),
            volUnit: vUnit,
          });
        });
      });
    });
    return rows;
  }, [userByEmail]);

  const modalRows = useMemo(
    () => (selected ? buildDisposalRows(selected.records) : []),
    [selected, buildDisposalRows],
  );

  const modalGroups = useMemo(() => {
    const map = new Map();
    modalRows.forEach((r) => {
      const name = r.slf || "—";
      // Group on the facility ID when the record carries one — grouping on the
      // NAME split a single SLF into two rows whenever some of its submissions
      // still held an older name snapshot, double-counting its trips and volume.
      const groupKey = r.slfId ? `id:${r.slfId}` : `name:${name}`;
      if (!map.has(groupKey)) {
        map.set(groupKey, { name, slfId: r.slfId || "", submittedBy: r.submittedBy || "", rows: [], refs: new Set(), users: new Set(), vol: {}, statusCounts: {} });
      }
      const g = map.get(groupKey);
      if (!g.slfId && r.slfId) g.slfId = r.slfId;
      if (!g.submittedBy && r.submittedBy) g.submittedBy = r.submittedBy;
      g.rows.push(r);
      if (r.ref && r.ref !== "—") g.refs.add(r.ref);
      if (r.user && r.user !== "Unknown user") g.users.add(r.user);
      if (r.volumeNum > 0) g.vol[r.volUnit] = (g.vol[r.volUnit] || 0) + r.volumeNum;
      if (r.statusKey && r.statusKey !== "—") g.statusCounts[r.statusKey] = (g.statusCounts[r.statusKey] || 0) + 1;
    });
    return [...map.values()]
      .map((g) => ({
        ...g,
        recordCount: g.refs.size || g.rows.length,
        userCount: g.users.size,
        volumeLabel: Object.entries(g.vol)
          .filter(([, v]) => v > 0)
          .map(([u, v]) => `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${u}`)
          .join(" · "),
      }))
      .sort((a, b) => b.rows.length - a.rows.length);
  }, [modalRows]);

  const openSubmissionsFor = useCallback((ctx = {}) => {
    if (!canOpenSubmissions || typeof onOpenSubmissions !== "function") return;
    onOpenSubmissions({
      tab: "submissions",
      date: selectedDate ? selectedDate.format("YYYY-MM-DD") : undefined,
      ...ctx,
    });
    setSelectedDate(null);
  }, [canOpenSubmissions, onOpenSubmissions, selectedDate]);

  // Column set shared by every facility's trip table inside the accordion.
  const disposalColumns = [
    {
      title: "Reference",
      dataIndex: "ref",
      width: 130,
      ellipsis: { showTitle: false },
      render: (v) => (
        <Tooltip title={v}>
          <Text strong style={{ fontSize: 12 }}>{v}</Text>
        </Tooltip>
      ),
    },
    {
      title: "Date",
      dataIndex: "date",
      width: 110,
      render: (v) => (
        <Text style={{ fontSize: 12 }}>{v ? dayjs(v).format("MMM D, YYYY") : "—"}</Text>
      ),
    },
    {
      title: "Hauler",
      dataIndex: "hauler",
      width: 150,
      ellipsis: { showTitle: false },
      render: (v) => (
        <Tooltip title={v}>
          <Text style={{ fontSize: 12 }}>{v || "—"}</Text>
        </Tooltip>
      ),
    },
    {
      title: "Portal User",
      dataIndex: "user",
      width: 160,
      ellipsis: { showTitle: false },
      render: (v) => (
        <Tooltip title={v}>
          <Text style={{ fontSize: 12 }}>{v}</Text>
        </Tooltip>
      ),
    },
    {
      title: "Client",
      dataIndex: "client",
      width: 140,
      ellipsis: { showTitle: false },
      render: (v) => (
        <Tooltip title={v}>
          <Text style={{ fontSize: 12 }}>{v}</Text>
        </Tooltip>
      ),
    },
    {
      title: "Plate No.",
      dataIndex: "plate",
      width: 100,
      ellipsis: { showTitle: true },
      render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: "Cell",
      dataIndex: "cell",
      width: 90,
      ellipsis: { showTitle: true },
      render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: "Waste Type",
      dataIndex: "wasteType",
      width: 130,
      ellipsis: { showTitle: true },
      render: (v) =>
        v && v !== "—" ? (
          <Tag color={/hazard/i.test(v) ? "volcano" : "green"} style={{ fontSize: 11 }}>
            {v}
          </Tag>
        ) : (
          "—"
        ),
    },
    {
      title: "Volume",
      dataIndex: "volume",
      width: 110,
      align: "right",
      render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 110,
      render: (v) => {
        const s = String(v || "").toLowerCase();
        const color = s.includes("acknowledg") || s.includes("approv")
          ? "green"
          : s.includes("revert") || s.includes("reject")
            ? "red"
            : "gold";
        return v && v !== "—" ? <Tag color={color} style={{ fontSize: 11 }}>{v}</Tag> : "—";
      },
    },
  ];

  useEffect(() => {
    if (!selectedDate) return undefined;
    setModalPreparing(true);
    const t = setTimeout(() => setModalPreparing(false), 120);
    return () => clearTimeout(t);
  }, [selectedDate]);

  return (
    <div
      style={{
        background: isDark ? "transparent" : "#fff",
        borderRadius: 10,
        border: `1px solid ${border}`,
        padding: 8,
        ...(height
          ? { height, display: "flex", flexDirection: "column", overflow: "hidden" }
          : {}),
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 10,
          padding: "4px 4px 0",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Text strong style={{ fontSize: 15, display: "block" }}>
            <CalendarOutlined style={{ color: "#1677ff", marginRight: 6 }} />
            SLF Operators Disposal Submission Calendar
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Recorded disposal activities by date across SLF Portal Operators and
            facilities. Click a day to see that day&apos;s disposal records.
          </Text>
        </div>
        {!loading && records.length > 0 && (
          <Space size={8} wrap>
            <Select
              size="small"
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="All Portal users"
              value={filterUser}
              onChange={setFilterUser}
              options={userOptions}
              style={{ minWidth: 170 }}
              suffixIcon={<UserOutlined />}
            />
            <Select
              size="small"
              allowClear
              showSearch
              filterOption={(input, opt) => String(opt?.value || "").toLowerCase().includes(input.toLowerCase())}
              optionLabelProp="value"
              placeholder="All SLFs"
              value={filterSlf}
              onChange={setFilterSlf}
              options={slfOptions}
              style={{ minWidth: 160 }}
            />
            {(filterUser || filterSlf) && (
              <Button
                size="small"
                type="link"
                onClick={() => {
                  setFilterUser(null);
                  setFilterSlf(null);
                }}
              >
                Reset
              </Button>
            )}
            <Segmented
              size="small"
              value={viewMode}
              onChange={setViewMode}
              options={[
                { label: "Week", value: "week" },
                { label: "Month", value: "month" },
                { label: "Year", value: "year" },
              ]}
            />
          </Space>
        )}
      </div>

      {/* Month/Year navigation — upper-left. Prev/Next step the visible period and
          the active label shows the current month+year (or year). Keyboard-accessible
          buttons; filters and any selected SLF are preserved. */}
      {!loading && records.length > 0 && viewMode !== "week" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px 6px" }}>
          <Button
            size="small"
            icon={<LeftOutlined />}
            aria-label={viewMode === "year" ? "Previous year" : "Previous month"}
            onClick={() => setCursor((c) => c.subtract(1, viewMode === "year" ? "year" : "month"))}
          />
          <Text strong style={{ fontSize: 13, minWidth: 128, textAlign: "center" }}>
            {viewMode === "year" ? cursor.format("YYYY") : cursor.format("MMMM YYYY")}
          </Text>
          <Button
            size="small"
            icon={<RightOutlined />}
            aria-label={viewMode === "year" ? "Next year" : "Next month"}
            onClick={() => setCursor((c) => c.add(1, viewMode === "year" ? "year" : "month"))}
          />
          <Button size="small" type="link" onClick={() => setCursor(dayjs())}>Today</Button>
        </div>
      )}
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <Spin />
          <div style={{ marginTop: 12 }}>
            <Text type="secondary">Loading daily disposal activity…</Text>
          </div>
        </div>
      ) : records.length === 0 ? (
        <Empty description="No disposal records with dates yet." style={{ padding: "32px 0" }} />
      ) : filteredRecords.length === 0 ? (
        <Empty description="No disposal records match the selected filters." style={{ padding: "32px 0" }} />
      ) : (
        <div
          className={`slf-cal-compact${height && viewMode === "month" ? " slf-cal-fill" : ""}`}
          style={height ? { flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" } : undefined}
        >
          {viewMode === "week" ? (
            renderWeekStrip()
          ) : viewMode === "year" ? (
            renderYearGrid()
          ) : (
            <Calendar
              value={cursor}
              onPanelChange={(v) => setCursor(v)}
              cellRender={cellRender}
              onSelect={(date, info) => {
                if (info?.source === "date" || !info) openDay(date);
              }}
            />
          )}
        </div>
      )}

      <style>{`
        .slf-cal-compact .ant-picker-calendar-date {
          margin: 0 !important;
          padding: 2px 4px !important;
          height: auto !important;
          border-top-width: 2px !important;
        }
        .slf-cal-compact .ant-picker-calendar-date-value {
          font-size: 12px !important;
          line-height: 1.2 !important;
          height: auto !important;
        }
        .slf-cal-compact .ant-picker-calendar-date-content {
          height: 34px !important;
          min-height: 34px !important;
          overflow: hidden !important;
        }
        .slf-cal-compact .slf-cal-cell {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1px;
          padding-top: 1px;
        }
        .slf-cal-compact .slf-cal-count {
          font-size: 10px;
          color: ${isDark ? "#8c8c8c" : "#8c8c8c"};
          line-height: 1.1;
        }
        /* Item #6: status counts on a single horizontal row. nowrap keeps the
           icons+counts on one line; overflow-x lets a busy cell scroll rather than
           wrap or spill into the neighbouring day. Thin/hidden scrollbar. */
        .slf-cal-statusrow {
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: center;
          gap: 8px;
          flex-wrap: nowrap;
          white-space: nowrap;
          max-width: 100%;
          overflow-x: auto;
          overflow-y: hidden;
          line-height: 1.1;
          scrollbar-width: none;
        }
        .slf-cal-statusrow::-webkit-scrollbar { display: none; }
        .slf-cal-statusrow > * { flex: 0 0 auto; }
        /* Pending submission indicator + avatar accent (yellow, distinct from
           approved/rejected). CSS-only pulse; respects reduced-motion. */
        .slf-cal-pending {
          font-size: 10px;
          font-weight: 600;
          color: #d48806;
          line-height: 1.1;
          display: inline-flex;
          align-items: center;
          gap: 2px;
        }
        /* Pending RESUBMISSION — distinct resubmission colour (orange), separate
           from a pending initial submission. */
        .slf-cal-resub {
          font-size: 10px;
          font-weight: 600;
          color: #fa8c16;
          line-height: 1.1;
          display: inline-flex;
          align-items: center;
          gap: 2px;
        }
        /* Acknowledged submissions (green ✓). */
        .slf-cal-ack {
          font-size: 10px;
          font-weight: 600;
          color: #389e0d;
          line-height: 1.1;
          display: inline-flex;
          align-items: center;
          gap: 2px;
        }
        .slf-pending-avatar {
          border: 2px solid #faad14 !important;
          box-shadow: 0 0 0 0 rgba(250,173,20,0.6);
          animation: slfPendingPulse 2.2s ease-out infinite;
        }
        @keyframes slfPendingPulse {
          0% { box-shadow: 0 0 0 0 rgba(250,173,20,0.55); }
          70% { box-shadow: 0 0 0 5px rgba(250,173,20,0); }
          100% { box-shadow: 0 0 0 0 rgba(250,173,20,0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .slf-pending-avatar { animation: none; box-shadow: 0 0 0 2px rgba(250,173,20,0.35); }
        }
        .slf-cal-compact .ant-picker-calendar-header {
          padding-bottom: 6px !important;
        }
        /* #4: stretch the month grid to fill the card body and remove the gap below
           it. Every wrapper from the calendar root down to the month table becomes a
           flex column (flex:1) so the table inherits a definite height; the HTML
           table + rows then distribute that height evenly across all 5 or 6 weeks.
           No fixed row height is used, so shorter months still fill and small screens
           never overflow. */
        .slf-cal-fill { height: 100%; }
        .slf-cal-fill .ant-picker-calendar,
        .slf-cal-fill .ant-picker-calendar .ant-picker-panel,
        .slf-cal-fill .ant-picker-calendar .ant-picker-date-panel,
        .slf-cal-fill .ant-picker-calendar .ant-picker-body {
          display: flex !important;
          flex-direction: column;
          flex: 1 1 auto;
          min-height: 0;
        }
        .slf-cal-fill .ant-picker-calendar .ant-picker-body { padding-bottom: 0 !important; }
        .slf-cal-fill .ant-picker-calendar .ant-picker-content {
          flex: 1 1 auto;
          height: 100%;
          border-collapse: collapse;
        }
        .slf-cal-fill .ant-picker-calendar .ant-picker-content tbody { height: 100%; }
        .slf-cal-fill .ant-picker-calendar .ant-picker-content tbody tr { height: auto; }
        .slf-cal-fill .ant-picker-cell { height: auto; vertical-align: top; }
        .slf-cal-fill .ant-picker-calendar-date {
          height: 100% !important;
          display: flex !important;
          flex-direction: column;
        }
        .slf-cal-fill .ant-picker-calendar-date-content {
          flex: 1 1 auto !important;
          height: auto !important;
          min-height: 44px !important;
          overflow: hidden !important;
        }
      `}</style>

      <Modal
        open={!!selectedDate && !!selected}
        onCancel={() => setSelectedDate(null)}
        footer={
          canOpenSubmissions ? (
            <div style={{ textAlign: "right" }}>
              <Button
                type="primary"
                icon={<ExportOutlined />}
                onClick={() => openSubmissionsFor()}
              >
                View All Submissions
              </Button>
            </div>
          ) : null
        }
        destroyOnHidden
        width="min(1200px, 100vw)"
        style={{ top: 24 }}
        title={
          <Space>
            <CalendarOutlined style={{ color: "#1677ff" }} />
            <span>
              Disposal Activity — {selectedDate ? selectedDate.format("MMMM D, YYYY") : ""}
            </span>
          </Space>
        }
        styles={{ body: { maxHeight: "68vh", overflowY: "auto", overflowX: "hidden" } }}
      >
        {selected && (
          <>
            <Space wrap style={{ marginBottom: 12 }}>
              <Badge count={selected.records.length} color="#1677ff" />
              <Text type="secondary">
                {modalGroups.length} facilit{modalGroups.length !== 1 ? "ies" : "y"} ·{" "}
                {selected.users.length} portal user(s) · {selected.records.length} record(s)
              </Text>
              {renderAvatars(selected.users, "default")}
            </Space>
            {modalPreparing ? (
              <Skeleton active paragraph={{ rows: 6 }} title={false} />
            ) : modalRows.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No disposal records for this date."
                style={{ padding: "32px 0" }}
              />
            ) : (
              <Collapse
                accordion={false}
                defaultActiveKey={[]}
                bordered={false}
                items={modalGroups.map((g) => ({
                  key: g.name,
                  label: (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <Space size={8} style={{ minWidth: 0 }}>
                        <BankOutlined style={{ color: "#1677ff" }} />
                        <Text strong style={{ fontSize: 13 }} ellipsis={{ tooltip: g.name }}>
                          {g.name}
                        </Text>
                        <Tag color="blue" style={{ margin: 0 }}>
                          {g.recordCount} record{g.recordCount !== 1 ? "s" : ""}
                        </Tag>
                      </Space>
                      <Space size={12} wrap style={{ fontSize: 11 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          <CarOutlined style={{ marginRight: 4 }} />
                          {g.rows.length} trip{g.rows.length !== 1 ? "s" : ""}
                        </Text>
                        {g.userCount > 0 && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            <UserOutlined style={{ marginRight: 4 }} />
                            {g.userCount} user{g.userCount !== 1 ? "s" : ""}
                          </Text>
                        )}
                        {g.volumeLabel && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            <InboxOutlined style={{ marginRight: 4 }} />
                            {g.volumeLabel}
                          </Text>
                        )}
                        {Object.keys(g.statusCounts || {}).length > 0 && (
                          <Space size={4} wrap onClick={(e) => e.stopPropagation()}>
                            {Object.entries(g.statusCounts).map(([k, count]) => {
                              const meta = statusMeta(k);
                              return (
                                <Tooltip key={k} title={`${count} ${meta.label.toLowerCase()} record${count === 1 ? "" : "s"} for this SLF on this date`}>
                                  <Tag color={meta.color} icon={meta.icon} style={{ margin: 0, fontSize: 11 }}>
                                    {meta.label}{count > 1 ? ` ×${count}` : ""}
                                  </Tag>
                                </Tooltip>
                              );
                            })}
                          </Space>
                        )}
                        {canOpenSubmissions && (
                          <Tooltip title={`View ${g.name} submissions in Portal Submissions`}>
                            <Button
                              size="small"
                              type="link"
                              icon={<ExportOutlined />}
                              onClick={(e) => {
                                e.stopPropagation();
                                openSubmissionsFor({
                                  slfId: g.slfId || undefined,
                                  slfName: g.name,
                                  portalUserId: g.submittedBy || undefined,
                                });
                              }}
                              style={{ padding: 0, fontSize: 11, height: "auto" }}
                            >
                              Submissions
                            </Button>
                          </Tooltip>
                        )}
                      </Space>
                    </div>
                  ),
                  children: (
                    <Table
                      size="small"
                      dataSource={g.rows}
                      rowKey="key"
                      tableLayout="fixed"
                      pagination={
                        g.rows.length > 10
                          ? { pageSize: 10, size: "small", showSizeChanger: false, hideOnSinglePage: true }
                          : false
                      }
                      scroll={{ x: 1020 }}
                      columns={disposalColumns}
                    />
                  ),
                }))}
              />
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
