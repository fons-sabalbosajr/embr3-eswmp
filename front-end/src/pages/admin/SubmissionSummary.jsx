import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import { CalendarOutlined, EyeOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import api from "../../api";
import { fetchWithCache, invalidateCache } from "../../utils/pageCache";
import { getSocket } from "../../utils/socket";
import { matchesFilter, rowMatchesSearch } from "./shared/tableFilters";

const { Text } = Typography;
const ACCENT = "#2f54eb";
const TON_PER_M3 = 0.2;
const SUMMARY_CACHE_KEY = "submission-summary-cache";
const SUMMARY_CACHE_TTL = 10 * 60 * 1000;

const normalizeUnit = (unit) => (unit || "m³").replace("m3", "m³");
const normalizeKey = (value) => String(value || "")
  .replace(/\s*\(.*?\)\s*/g, " ")
  .replace(/\blocal\s+governm\s*ent\s+unit\b/gi, " ")
  .replace(/\blgu\b/gi, " ")
  .replace(/\bmunicipality\s+of\b/gi, " ")
  .replace(/\bcity\s+of\b/gi, " ")
  .replace(/^province\s+of\s+/i, "")
  .replace(/[\u2012-\u2015-]+/g, " ")
  .replace(/[,.;:/]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();
const isActiveCellStatus = (status) => /active|operational|open|current/i.test(String(status || "Active"));

const convertVolume = (value, fromUnit = "m³", toUnit = fromUnit) => {
  const number = Number(value || 0);
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit || from);
  if (!number || from === to) return number;
  if (from === "tons" && to === "m³") return number / TON_PER_M3;
  if (from === "m³" && to === "tons") return number * TON_PER_M3;
  return number;
};

const statusColor = {
  pending: "gold",
  acknowledged: "green",
  rejected: "red",
  reverted: "volcano",
  revert_requested: "orange",
};

function emptySummary(slfName) {
  return {
    key: slfName || "Unassigned SLF",
    slfName: slfName || "Unassigned SLF",
    submissions: 0,
    trucks: 0,
    generators: new Set(),
    submitters: new Set(),
    statuses: {},
    residualM3: 0,
    residualTons: 0,
    hazardousM3: 0,
    hazardousTons: 0,
    totalM3: 0,
    totalTons: 0,
    lastDisposalDate: null,
    records: [],
  };
}

function addVolume(target, wasteType, value, unit) {
  const amount = Number(value || 0);
  if (!amount) return;
  const normalizedUnit = normalizeUnit(unit);
  const isHazardous = /hazard/i.test(String(wasteType || ""));
  const totalKey = normalizedUnit === "tons" ? "totalTons" : "totalM3";
  const wasteKey = isHazardous
    ? normalizedUnit === "tons" ? "hazardousTons" : "hazardousM3"
    : normalizedUnit === "tons" ? "residualTons" : "residualM3";
  target[totalKey] += amount;
  target[wasteKey] += amount;
}

function formatVolume(m3, tons) {
  const parts = [];
  if (m3 > 0) parts.push(`${m3.toLocaleString()} m³`);
  if (tons > 0) parts.push(`${tons.toLocaleString()} tons`);
  return parts.length ? parts.join(" / ") : "—";
}

function getRecordSlfName(record) {
  return record.slfName || record.slfGenerator?.slfName || "Unassigned SLF";
}

function addNameVariant(map, name, value) {
  const key = normalizeKey(name);
  if (key && !map.has(key)) map.set(key, value);
  const firstCommaPart = String(name || "").split(",")[0]?.trim();
  const shortKey = normalizeKey(firstCommaPart);
  if (shortKey && !map.has(shortKey)) map.set(shortKey, value);
}

function getTruckTotals(records) {
  return records.reduce((acc, record) => {
    (record.trucks || []).forEach((truck) => {
      const unit = normalizeUnit(truck.actualVolumeUnit || record.baselineUnit || "m³");
      if (unit === "tons") acc.tons += Number(truck.actualVolume || 0);
      else acc.m3 += Number(truck.actualVolume || 0);
    });
    return acc;
  }, { m3: 0, tons: 0 });
}

function buildBaselineTotals(baseline) {
  const totals = { m3: 0, tons: 0 };
  if (!baseline) return totals;
  const add = (value, unit) => {
    const normalized = normalizeUnit(unit || baseline.baselineUnit || "m³");
    if (normalized === "tons") totals.tons += Number(value || 0);
    else totals.m3 += Number(value || 0);
  };
  (baseline.activeCellEntries || []).forEach((entry) => add(entry.volume, entry.unit));
  if (!(baseline.activeCellEntries || []).length) {
    add(baseline.activeCellResidualVolume, baseline.activeCellResidualUnit);
    add(baseline.activeCellInertVolume, baseline.activeCellInertUnit);
    add(baseline.activeCellHazardousVolume, baseline.activeCellHazardousUnit);
  }
  return totals;
}

function buildCellStatusRows(summary, throughDate, settings = {}) {
  const facility = summary.facility;
  const baseline = summary.baseline;
  const cellCount = Math.max(
    facility?.numberOfCells || 0,
    facility?.cellCapacities?.length || 0,
    baseline?.activeCellEntries?.length || 0,
    1,
  );
  const statuses = facility?.cellStatuses || [];
  const capacities = facility?.cellCapacities || [];
  const capacityUnits = facility?.cellCapacityUnits || [];
  const fillValues = facility?.cellFillValues || [];
  const fillUnits = facility?.cellFillUnits || [];
  const baselineDate = baseline?.lastUpdated || baseline?.createdAt;
  const cumulativeRecords = summary.records.filter((record) => {
    if (!record.dateOfDisposal) return false;
    const withinDate = dayjs(record.dateOfDisposal).startOf("day").valueOf() <= dayjs(throughDate).startOf("day").valueOf();
    if (!withinDate) return false;
    if (!settings.excludePreBaselineDisposalFromCellFill || !baselineDate) return true;
    const disposalBeforeBaseline = dayjs(record.dateOfDisposal).startOf("day").isBefore(dayjs(baselineDate).startOf("day"));
    const submittedAfterBaseline = record.createdAt && dayjs(record.createdAt).isAfter(dayjs(baselineDate));
    return !disposalBeforeBaseline || submittedAfterBaseline;
  });
  const cumulative = getTruckTotals(cumulativeRecords);

  return Array.from({ length: cellCount }).map((_, index) => {
    const status = statuses[index] || (index === 0 ? "Active" : "Available");
    const capacity = Number(capacities[index] || 0);
    const unit = normalizeUnit(capacityUnits[index] || fillUnits[index] || baseline?.baselineUnit || "m³");
    const baselineEntries = baseline?.activeCellEntries || [];
    const baselineForCell = baselineEntries[index]
      ? convertVolume(baselineEntries[index].volume, baselineEntries[index].unit, unit)
      : index === 0
        ? convertVolume(buildBaselineTotals(baseline).m3, "m³", unit) + convertVolume(buildBaselineTotals(baseline).tons, "tons", unit)
        : 0;
    const submissionForCell = isActiveCellStatus(status)
      ? convertVolume(cumulative.m3, "m³", unit) + convertVolume(cumulative.tons, "tons", unit)
      : 0;
    const encodedFill = convertVolume(fillValues[index] || 0, fillUnits[index] || unit, unit);
    const used = Math.max(encodedFill, baselineForCell + submissionForCell);
    const pct = capacity > 0 ? Math.min(Math.round((used / capacity) * 100), 100) : null;
    return {
      key: index,
      cell: `Cell ${index + 1}`,
      status,
      used,
      capacity,
      remaining: capacity > 0 ? Math.max(0, capacity - used) : null,
      unit,
      pct,
      isActive: isActiveCellStatus(status),
    };
  });
}

export default function SubmissionSummary({ isDark }) {
  const [records, setRecords] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [baselines, setBaselines] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [calendarRecord, setCalendarRecord] = useState(null);
  const [calendarDate, setCalendarDate] = useState(dayjs());
  const [submissionDetail, setSubmissionDetail] = useState(null);

  const fetchRecords = useCallback(async ({ force = false, silent = false } = {}) => {
    await fetchWithCache(
      SUMMARY_CACHE_KEY,
      async () => {
        const [recordsRes, facilitiesRes, baselinesRes, settingsRes] = await Promise.all([
          api.get("/data-slf", { params: { mode: "list" } }),
          api.get("/slf-facilities"),
          api.get("/data-slf/baselines"),
          api.get("/settings/app"),
        ]);
        return {
          records: Array.isArray(recordsRes.data) ? recordsRes.data : [],
          facilities: Array.isArray(facilitiesRes.data) ? facilitiesRes.data : [],
          baselines: Array.isArray(baselinesRes.data) ? baselinesRes.data : [],
          settings: settingsRes.data || {},
        };
      },
      {
        ttl: SUMMARY_CACHE_TTL,
        force,
        onStart: () => !silent && setLoading(true),
        onEnd: () => !silent && setLoading(false),
        onData: (payload = {}) => {
          setRecords(payload.records || []);
          setFacilities(payload.facilities || []);
          setBaselines(payload.baselines || []);
          setSettings(payload.settings || {});
          setLoading(false);
        },
        onError: () => {
          if (!silent) {
            setRecords([]);
            setFacilities([]);
            setBaselines([]);
          }
        },
      },
    );
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const handler = ({ target } = {}) => {
      if (!target || ["submissions", "baselines"].includes(target)) {
        invalidateCache(SUMMARY_CACHE_KEY);
        fetchRecords({ force: true, silent: true });
      }
    };
    socket.on("data-refresh", handler);
    return () => socket.off("data-refresh", handler);
  }, [fetchRecords]);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const statusMatch = statusFilter === "all" || matchesFilter(record.status, statusFilter);
      if (!statusMatch) return false;
      return rowMatchesSearch(record, search, [
        "idNo",
        "submissionId",
        "lguCompanyName",
        "submittedBy",
        "companyType",
        "slfName",
        (item) => item.slfGenerator?.slfName,
        (item) => (item.trucks || []).map((truck) => [truck.plateNumber, truck.hauler, truck.haulerName, truck.wasteType]),
      ]);
    });
  }, [records, search, statusFilter]);

  const facilityMap = useMemo(() => {
    const map = new Map();
    facilities.forEach((facility) => {
      addNameVariant(map, facility.lgu, facility);
      addNameVariant(map, facility.province, facility);
      addNameVariant(map, facility.slfName, facility);
    });
    return map;
  }, [facilities]);

  const baselineMap = useMemo(() => {
    const map = new Map();
    baselines.forEach((baseline) => {
      addNameVariant(map, baseline.slfName, baseline);
      addNameVariant(map, baseline.lguCompanyName, baseline);
    });
    return map;
  }, [baselines]);

  const summaryRows = useMemo(() => {
    const map = new Map();
    filteredRecords.forEach((record) => {
      const slfName = getRecordSlfName(record);
      if (!map.has(slfName)) map.set(slfName, emptySummary(slfName));
      const summary = map.get(slfName);
      summary.submissions += 1;
      summary.trucks += record.trucks?.length || 0;
      if (record.lguCompanyName) summary.generators.add(record.lguCompanyName);
      if (record.submittedBy) summary.submitters.add(record.submittedBy);
      summary.statuses[record.status || "pending"] = (summary.statuses[record.status || "pending"] || 0) + 1;
      const disposalDate = record.dateOfDisposal ? dayjs(record.dateOfDisposal) : null;
      if (disposalDate?.isValid() && (!summary.lastDisposalDate || disposalDate.isAfter(summary.lastDisposalDate))) {
        summary.lastDisposalDate = disposalDate;
      }
      (record.trucks || []).forEach((truck) => {
        addVolume(summary, truck.wasteType, truck.actualVolume, truck.actualVolumeUnit || record.baselineUnit || "m³");
      });
      summary.records.push(record);
    });
    return Array.from(map.values()).map((row) => {
      const facility = facilityMap.get(normalizeKey(row.slfName));
      const baseline = baselineMap.get(normalizeKey(row.slfName));
      const baselineTotals = buildBaselineTotals(baseline);
      return {
        ...row,
        facility,
        baseline,
        baselineTotals,
        generatorCount: row.generators.size,
        submitterCount: row.submitters.size,
      };
    }).sort((a, b) => a.slfName.localeCompare(b.slfName));
  }, [filteredRecords, facilityMap, baselineMap]);

  const selectedDayRecords = useMemo(() => {
    if (!calendarRecord) return [];
    return calendarRecord.records.filter((record) =>
      record.dateOfDisposal && dayjs(record.dateOfDisposal).isSame(calendarDate, "day")
    );
  }, [calendarRecord, calendarDate]);

  const selectedDayTotals = useMemo(() => selectedDayRecords.reduce((acc, record) => {
    acc.submissions += 1;
    acc.trucks += record.trucks?.length || 0;
    (record.trucks || []).forEach((truck) => {
      const unit = normalizeUnit(truck.actualVolumeUnit || record.baselineUnit || "m³");
      if (unit === "tons") acc.tons += Number(truck.actualVolume || 0);
      else acc.m3 += Number(truck.actualVolume || 0);
    });
    return acc;
  }, { submissions: 0, trucks: 0, m3: 0, tons: 0 }), [selectedDayRecords]);

  const selectedCellRows = useMemo(() => {
    if (!calendarRecord) return [];
    return buildCellStatusRows(calendarRecord, calendarDate, settings);
  }, [calendarRecord, calendarDate, settings]);

  const selectedCumulativeTotals = useMemo(() => {
    if (!calendarRecord) return { m3: 0, tons: 0 };
    const throughDateRecords = calendarRecord.records.filter((record) =>
      record.dateOfDisposal && dayjs(record.dateOfDisposal).startOf("day").valueOf() <= calendarDate.startOf("day").valueOf(),
    );
    const submissions = getTruckTotals(throughDateRecords);
    return {
      m3: (calendarRecord.baselineTotals?.m3 || 0) + submissions.m3,
      tons: (calendarRecord.baselineTotals?.tons || 0) + submissions.tons,
    };
  }, [calendarRecord, calendarDate]);

  const dayMap = useMemo(() => {
    const map = {};
    if (!calendarRecord) return map;
    calendarRecord.records.forEach((record) => {
      if (!record.dateOfDisposal) return;
      const key = dayjs(record.dateOfDisposal).format("YYYY-MM-DD");
      if (!map[key]) map[key] = { count: 0, m3: 0, tons: 0 };
      map[key].count += 1;
      (record.trucks || []).forEach((truck) => {
        const unit = normalizeUnit(truck.actualVolumeUnit || record.baselineUnit || "m³");
        if (unit === "tons") map[key].tons += Number(truck.actualVolume || 0);
        else map[key].m3 += Number(truck.actualVolume || 0);
      });
    });
    return map;
  }, [calendarRecord]);

  const calendarEvents = useMemo(() => Object.entries(dayMap).map(([date, item]) => ({
    id: date,
    start: date,
    allDay: true,
    title: formatVolume(item.m3 || 0, item.tons || 0),
    backgroundColor: ACCENT,
    borderColor: ACCENT,
    textColor: "#fff",
    extendedProps: item,
  })), [dayMap]);

  const totals = useMemo(() => summaryRows.reduce((acc, row) => ({
    submissions: acc.submissions + row.submissions,
    trucks: acc.trucks + row.trucks,
    m3: acc.m3 + row.totalM3,
    tons: acc.tons + row.totalTons,
  }), { submissions: 0, trucks: 0, m3: 0, tons: 0 }), [summaryRows]);

  const columns = [
    {
      title: "SLF",
      dataIndex: "slfName",
      fixed: "left",
      width: 240,
      render: (value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{value}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{row.generatorCount} generator(s) / {row.submitterCount} submitter(s)</Text>
        </Space>
      ),
    },
    { title: "Submissions", dataIndex: "submissions", width: 110, align: "center", sorter: (a, b) => a.submissions - b.submissions },
    { title: "Trucks", dataIndex: "trucks", width: 90, align: "center", sorter: (a, b) => a.trucks - b.trucks },
    {
      title: "Waste Volume",
      width: 190,
      render: (_, row) => <Text strong>{formatVolume(row.totalM3, row.totalTons)}</Text>,
    },
    { title: "Residual", width: 170, render: (_, row) => formatVolume(row.residualM3, row.residualTons) },
    { title: "Hazardous", width: 170, render: (_, row) => formatVolume(row.hazardousM3, row.hazardousTons) },
    {
      title: "Status Summary",
      width: 230,
      render: (_, row) => (
        <Space size={4} wrap>
          {Object.entries(row.statuses).map(([status, count]) => (
            <Tag key={status} color={statusColor[status] || "default"} style={{ margin: 0 }}>
              {status.replace("_", " ")}: {count}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "Last Disposal",
      dataIndex: "lastDisposalDate",
      width: 130,
      render: (value) => value ? value.format("MM/DD/YYYY") : "—",
      sorter: (a, b) => (a.lastDisposalDate?.valueOf() || 0) - (b.lastDisposalDate?.valueOf() || 0),
    },
    {
      title: "Calendar",
      width: 110,
      align: "center",
      render: (_, row) => (
        <Button
          size="small"
          icon={<CalendarOutlined />}
          onClick={() => {
            setCalendarRecord(row);
            setCalendarDate(row.lastDisposalDate || dayjs());
          }}
        >
          View
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic title="SLFs" value={summaryRows.length} valueStyle={{ color: ACCENT }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic title="Submissions" value={totals.submissions} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic title="Truck Entries" value={totals.trucks} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic title="Waste Volume" value={formatVolume(totals.m3, totals.tons)} valueStyle={{ fontSize: 18 }} />
          </Card>
        </Col>
      </Row>

      <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: 16 }}>
        <Space style={{ marginBottom: 14, flexWrap: "wrap" }}>
          <Input
            placeholder="Search SLF, generator, ID, or email..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            allowClear
            style={{ width: 300, maxWidth: "100%" }}
          />
          <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 180 }}>
            <Select.Option value="all">All Statuses</Select.Option>
            <Select.Option value="pending">Pending</Select.Option>
            <Select.Option value="acknowledged">Acknowledged</Select.Option>
            <Select.Option value="rejected">Rejected</Select.Option>
            <Select.Option value="revert_requested">Revert Requested</Select.Option>
            <Select.Option value="reverted">Reverted</Select.Option>
          </Select>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => fetchRecords({ force: true })}>Refresh</Button>
        </Space>
        <Table
          dataSource={summaryRows}
          columns={columns}
          loading={loading}
          rowKey="key"
          size="middle"
          pagination={{ pageSize: 12, showTotal: (total) => `${total} SLF summary row(s)` }}
          scroll={{ x: 1420 }}
          locale={{ emptyText: <Empty description="No submissions to summarize" /> }}
        />
      </Card>

      <Modal
        title={calendarRecord ? <Space><CalendarOutlined /> <span>{calendarRecord.slfName}</span><Text type="secondary" style={{ fontSize: 13 }}>Disposal Calendar</Text></Space> : "Disposal Calendar"}
        open={!!calendarRecord}
        onCancel={() => setCalendarRecord(null)}
        footer={<Button onClick={() => setCalendarRecord(null)}>Close</Button>}
        width={1600}
        destroyOnHidden
      >
        {calendarRecord && (
          <Row gutter={[16, 16]}>
            <Col span={24}>
              <Row gutter={[12, 12]}>
                <Col xs={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8 }}><Statistic title="Total Submissions" value={calendarRecord.submissions} /></Card>
                </Col>
                <Col xs={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8 }}><Statistic title="Truck Entries" value={calendarRecord.trucks} /></Card>
                </Col>
                <Col xs={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8 }}><Statistic title="Selected Date" value={selectedDayTotals.submissions} suffix="submission(s)" valueStyle={{ fontSize: 20, color: ACCENT }} /></Card>
                </Col>
                <Col xs={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8 }}><Statistic title="Selected Volume" value={formatVolume(selectedDayTotals.m3, selectedDayTotals.tons)} valueStyle={{ fontSize: 16 }} /></Card>
                </Col>
              </Row>
            </Col>
            <Col xs={24} lg={12}>
              <Card size="small" style={{ borderRadius: 8 }} bodyStyle={{ padding: 12 }}>
                <style>{`
                  .submission-fc .fc { font-size: 12px; }
                  .submission-fc .fc-toolbar-title { font-size: 18px; font-weight: 700; color: ${isDark ? "#f0f0f0" : "#1a3353"}; }
                  .submission-fc .fc-button { border-radius: 6px; padding: 4px 10px; }
                  .submission-fc .fc-daygrid-day { cursor: pointer; }
                  .submission-fc .fc-daygrid-day-number { font-weight: 600; color: ${isDark ? "#d9d9d9" : "#1a3353"}; }
                  .submission-fc .fc-selected-day { background: ${isDark ? "rgba(47,84,235,0.18)" : "#f0f5ff"}; }
                  .submission-fc .fc-event { border-radius: 6px; padding: 2px 4px; border: 0; }
                `}</style>
                <div className="submission-fc">
                  <FullCalendar
                    plugins={[dayGridPlugin, interactionPlugin]}
                    initialView="dayGridMonth"
                    initialDate={calendarDate.toDate()}
                    events={calendarEvents}
                    height={620}
                    fixedWeekCount={false}
                    dayMaxEvents={2}
                    headerToolbar={{ left: "prev,next today", center: "title", right: "" }}
                    dateClick={(info) => setCalendarDate(dayjs(info.date))}
                    eventClick={(info) => setCalendarDate(dayjs(info.event.start))}
                    dayCellClassNames={(arg) => dayjs(arg.date).isSame(calendarDate, "day") ? ["fc-selected-day"] : []}
                    eventContent={(eventInfo) => {
                      const item = eventInfo.event.extendedProps || {};
                      return (
                        <div style={{ lineHeight: 1.25, whiteSpace: "normal" }}>
                          <div style={{ fontWeight: 700 }}>{eventInfo.event.title}</div>
                          <div style={{ fontSize: 10, opacity: 0.9 }}>{item.count} submission{item.count !== 1 ? "s" : ""}</div>
                        </div>
                      );
                    }}
                  />
                </div>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card size="small" style={{ borderRadius: 8 }} title={calendarDate.format("MMMM D, YYYY")}>
                <Space size={6} wrap style={{ marginBottom: 12 }}>
                  <Tag color="blue">{selectedDayTotals.submissions} submission(s)</Tag>
                  <Tag color="cyan">{selectedDayTotals.trucks} truck(s)</Tag>
                  <Tag color="green">{formatVolume(selectedDayTotals.m3, selectedDayTotals.tons)}</Tag>
                  <Tag color="purple">Baseline + submissions: {formatVolume(selectedCumulativeTotals.m3, selectedCumulativeTotals.tons)}</Tag>
                </Space>
                <Table
                  size="small"
                  pagination={false}
                  dataSource={selectedCellRows}
                  rowKey="key"
                  style={{ marginBottom: 12 }}
                  columns={[
                    { title: "Cell", dataIndex: "cell", width: 72, render: (value, row) => <Text strong={row.isActive}>{value}</Text> },
                    { title: "Status", dataIndex: "status", width: 95, render: (value, row) => <Tag color={row.isActive ? "green" : "default"}>{value || "—"}</Tag> },
                    {
                      title: "Fill",
                      render: (_, row) => (
                        <Space direction="vertical" size={0}>
                          <Text>{row.used.toLocaleString(undefined, { maximumFractionDigits: 2 })} {row.unit}</Text>
                          {row.pct != null && <Text type="secondary" style={{ fontSize: 11 }}>{row.pct}% full</Text>}
                        </Space>
                      ),
                    },
                    {
                      title: "Remaining",
                      //width: 105,
                      render: (_, row) => row.remaining == null ? "—" : `${row.remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${row.unit}`,
                    },
                  ]}
                />
                <Table
                  size="small"
                  pagination={{ pageSize: 6, size: "small" }}
                  dataSource={selectedDayRecords}
                  rowKey={(record) => record._id}
                  locale={{ emptyText: "No submissions on this date" }}
                  columns={[
                    { title: "ID", dataIndex: "idNo", width: 90, render: (value, record) => <Text strong>{value || record.submissionId || "No ID"}</Text> },
                    { title: "Generator",  width: 120, dataIndex: "lguCompanyName", ellipsis: true, render: (value, record) => value || record.companyName || record.generatorName || "Not encoded" },
                    { title: "Trucks", width: 70, align: "center", render: (_, record) => record.trucks?.length || 0 },
                    {
                      title: "Volume",
                      width: 80,
                      render: (_, record) => {
                        const dayTotal = (record.trucks || []).reduce((acc, truck) => {
                          const unit = normalizeUnit(truck.actualVolumeUnit || record.baselineUnit || "m³");
                          if (unit === "tons") acc.tons += Number(truck.actualVolume || 0);
                          else acc.m3 += Number(truck.actualVolume || 0);
                          return acc;
                        }, { m3: 0, tons: 0 });
                        return formatVolume(dayTotal.m3, dayTotal.tons);
                      },
                    },
                    { title: "Status", dataIndex: "status", width: 90, render: (value) => <Tag color={statusColor[value] || "default"}>{value?.replace("_", " ") || "pending"}</Tag> },
                    { title: "", width: 54, render: (_, record) => <Button size="small" icon={<EyeOutlined />} onClick={() => setSubmissionDetail(record)} /> },
                  ]}
                />
              </Card>
              <Button
                icon={<EyeOutlined />}
                style={{ marginTop: 12 }}
                block
                disabled={selectedDayRecords.length === 0}
                onClick={() => selectedDayRecords[0] && setSubmissionDetail(selectedDayRecords[0])}
              >
                {selectedDayRecords.length} submission(s) on selected date
              </Button>
            </Col>
          </Row>
        )}
      </Modal>

      <Modal
        title={submissionDetail ? <Space><EyeOutlined /> <span>{submissionDetail.idNo || "Submission Details"}</span></Space> : "Submission Details"}
        open={!!submissionDetail}
        onCancel={() => setSubmissionDetail(null)}
        footer={<Button onClick={() => setSubmissionDetail(null)}>Close</Button>}
        width={900}
        destroyOnHidden
      >
        {submissionDetail && (
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <Row gutter={[12, 12]}>
              <Col xs={24} md={8}>
                <Card size="small" style={{ borderRadius: 8 }}>
                  <Statistic title="Generator" value={submissionDetail.lguCompanyName || submissionDetail.companyName || "Not encoded"} valueStyle={{ fontSize: 16 }} />
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card size="small" style={{ borderRadius: 8 }}>
                  <Statistic title="Disposal Date" value={submissionDetail.dateOfDisposal ? dayjs(submissionDetail.dateOfDisposal).format("MM/DD/YYYY") : "—"} valueStyle={{ fontSize: 16 }} />
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card size="small" style={{ borderRadius: 8 }}>
                  <Statistic title="Status" value={submissionDetail.status?.replace("_", " ") || "pending"} valueStyle={{ fontSize: 16 }} />
                </Card>
              </Col>
            </Row>
            <Table
              size="small"
              pagination={true}
              dataSource={submissionDetail.trucks || []}
              rowKey={(_, index) => index}
              locale={{ emptyText: "No truck entries recorded" }}
              columns={[
                { title: "Truck", width: 80, render: (_, __, index) => index + 1 },
                { title: "Ticket", dataIndex: "disposalTicketNo", render: (value) => value || "Not encoded" },
                { title: "Plate No.", dataIndex: "plateNumber", render: (value, truck) => value || truck.plateNo || "Not encoded" },
                { title: "Hauler", dataIndex: "hauler", render: (value, truck) => value || truck.haulerName || "Not encoded" },
                { title: "Waste Type", dataIndex: "wasteType", render: (value) => value || "Residual" },
                {
                  title: "Actual Volume",
                  align: "right",
                  render: (_, truck) => `${Number(truck.actualVolume || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${normalizeUnit(truck.actualVolumeUnit || submissionDetail.baselineUnit || "m³")}`,
                },
              ]}
            />
          </Space>
        )}
      </Modal>
    </div>
  );
}
