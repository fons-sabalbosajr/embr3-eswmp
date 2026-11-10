import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import {
  Tabs,
  Card,
  Row,
  Col,
  DatePicker,
  Select,
  Input,
  Button,
  Table,
  Space,
  Typography,
  Tag,
  Empty,
  Alert,
  Skeleton,
  Statistic,
} from "antd";
import {
  FileTextOutlined,
  BankOutlined,
  TeamOutlined,
  CarOutlined,
  UserOutlined,
  DashboardOutlined,
  FilePdfOutlined,
  DownloadOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import { aggregateHaulerClients, countClientsByType, classifyClientType } from "../../utils/haulerClients";
import { tonsFromMetricPair } from "../../utils/volumeUnits";
import { fetchAllSubmissions } from "./shared/submissionRecords";

const SlfSubmissionReport = lazy(() => import("./SlfSubmissionReport"));

const { Title, Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;

// ── Shared, lazily-fetched data (only requested when a tab first needs it) ──
const inRange = (date, range) => {
  if (!range || !range[0] || !range[1]) return true;
  const d = dayjs(date);
  return d.isValid() && !d.isBefore(range[0], "day") && !d.isAfter(range[1], "day");
};

// ── PSGC code → place name ──────────────────────────────────────────────────
// Submissions store companyRegion / companyProvince / companyMunicipality as
// PSGC CODES ("035400000"), which is what the Province column used to print.
// The names come from the server's cached PSGC proxy: one call for every
// province, one for every region, and one per DISTINCT province for its
// municipalities. Promises are memoised for the session and dropped on failure
// so a transient error is retried on the next Generate rather than sticking.
const memo = new Map();
const cachedGet = (url) => {
  if (!memo.has(url)) {
    memo.set(
      url,
      api.get(url)
        .then(({ data }) => (Array.isArray(data) ? data : []))
        .catch(() => { memo.delete(url); return []; }),
    );
  }
  return memo.get(url);
};
const isCodeLike = (v) => /^[0-9A-Z_-]{6,}$/i.test(String(v || "").trim()) && /\d{4,}/.test(String(v));
async function buildPlaceResolver(rows) {
  const passThrough = (value) => String(value || "").trim();
  const anyCode = rows.some((r) => [r.companyRegion, r.companyProvince, r.companyMunicipality].some(isCodeLike));
  if (!anyCode) return passThrough; // names already — nothing to look up
  const provinceCodes = [...new Set(rows.map((r) => r.companyProvince).filter(isCodeLike))];
  const [provinces, regions, ...munLists] = await Promise.all([
    cachedGet("/settings/address/provinces"),
    cachedGet("/settings/address/regions"),
    ...provinceCodes.map((c) => cachedGet(`/settings/address/municipalities/${encodeURIComponent(c)}`)),
  ]);
  const names = new Map();
  [...provinces, ...regions, ...munLists.flat()].forEach((p) => {
    if (p?.code && p?.name) names.set(String(p.code), p.name);
  });
  // A name already stored as text passes through; an unresolved code renders
  // as blank rather than leaking a nine-digit number into the report.
  return (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    return names.get(raw) || (isCodeLike(raw) ? "" : raw);
  };
}

// ── Table layout helpers ────────────────────────────────────────────────────
// Every preview table is fixed-layout with percentage widths so it fits the
// page instead of scrolling sideways, and every cell word-wraps (antd's
// `ellipsis` cut values off mid-name). Related fields share one column as a
// main line plus a muted sub-line.
const WRAP = { whiteSpace: "normal", wordBreak: "break-word", overflowWrap: "anywhere", verticalAlign: "top" };
const fitColumns = (columns) =>
  columns.map((col) => ({
    ...col,
    ellipsis: false,
    onCell: () => ({ style: WRAP }),
    onHeaderCell: () => ({ style: { ...WRAP, verticalAlign: "bottom" } }),
  }));
const dash = (v) => (v === undefined || v === null || v === "" || v === "—" ? null : v);
function Stack({ main, subs = [] }) {
  const lines = subs.filter((s) => dash(s) !== null);
  return (
    <div style={{ lineHeight: 1.35 }}>
      <div>{dash(main) ?? "—"}</div>
      {lines.map((s, i) => (
        <div key={i} style={{ fontSize: 11.5, color: "#8c8c8c" }}>{s}</div>
      ))}
    </div>
  );
}
const joinDot = (...parts) => parts.filter((p) => dash(p) !== null).join(" · ");
const statusColor = (v) =>
  /acknowledged|approved/i.test(v) ? "green" : /pending/i.test(v) ? "orange" : /reject|suspend/i.test(v) ? "red" : /revert/i.test(v) ? "gold" : "default";

// Each report declares only the filters it needs and a `run(filters)` that fetches
// from an EXISTING endpoint on demand (never on page load) and returns preview rows.
// Preview columns merge related fields; the EXPORT still carries every field flat.
const REPORTS = [
  {
    key: "submissions",
    tab: "Submission Reports",
    icon: <FileTextOutlined />,
    title: "Submission Reports",
    description: "Portal disposal submissions with status, generator, trucks and volume.",
    filters: ["dateRange", "status", "search"],
    columns: [
      { title: "Submission", key: "submission", width: "12%", render: (_, r) => <Stack main={r.idNo} subs={[r.date]} /> },
      { title: "SLF", dataIndex: "slf", width: "16%" },
      {
        title: "Generator / Location",
        key: "generator",
        width: "21%",
        render: (_, r) => (
          <Stack main={r.generator} subs={[joinDot(r.companyType, [r.municipality, r.province].filter((x) => dash(x)).join(", "))]} />
        ),
      },
      { title: "Trucks", dataIndex: "trucks", align: "right", width: "7%" },
      // TONS throughout — one unit per report. The declared unit is the
      // facility's own baseline unit, shown as context under the figures.
      {
        title: "Waste (tons)",
        key: "waste",
        width: "16%",
        render: (_, r) => (
          <Stack
            main={<strong>{r.volumeTons}</strong>}
            subs={[`Residual ${r.residualTons} · Hazardous ${r.hazardousTons}`, `Declared unit: ${r.unit}`]}
          />
        ),
      },
      { title: "Cell(s)", dataIndex: "cells", width: "13%" },
      {
        title: "Status",
        key: "status",
        width: "15%",
        render: (_, r) => (
          <Stack main={<Tag color={statusColor(r.status)} style={{ marginInlineEnd: 0 }}>{r.status}</Tag>} subs={[dash(r.submittedBy) && `by ${r.submittedBy}`]} />
        ),
      },
    ],
    run: async ({ dateRange, status, search }) => {
      // ── Scope on the SERVER, not after the fact ────────────────────────────
      //
      // This used to be `fetchAllSubmissions({ includeTrucks: "true" })` — every
      // submission in the database, with its full trucks[] (~36 KB a record; the
      // route's own note measures ~30 MB across 828 of them), pulled 100 at a
      // time in sequence — and only THEN filtered by status and search in the
      // browser. Generating a report for one status meant downloading every
      // other status first.
      //
      // `status` and `search` are both supported by GET /data-slf in list mode,
      // so they are passed down and the matching happens in Mongo.
      //
      // `includeTrucks` is dropped because nothing here reads a truck: the only
      // thing it was used for is the Cell(s) column, and the list row already
      // carries `cellNames` — computed server-side by collectCellNames, which
      // resolves a cell's INDEX against the facility's current names and so is
      // strictly more accurate than the raw `cellName` walk this replaces.
      // Everything else on the row is a denormalized metric field.
      const rows = await fetchAllSubmissions({
        ...(status && status !== "all" ? { status } : {}),
        ...(search ? { search } : {}),
      });
      const num = (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
      const scoped = rows
        // Date is the one filter the endpoint does not expose, so it stays here.
        .filter((r) => inRange(r.dateOfDisposal, dateRange))
        .filter((r) => {
          // The server's `search` also matches companyType and submissionId.
          // Re-applied here so the result set is exactly what it was before.
          if (!search) return true;
          const q = search.toLowerCase();
          return [r.idNo, r.slfName, r.lguCompanyName, r.submittedBy]
            .some((v) => String(v || "").toLowerCase().includes(q));
        });
      const place = await buildPlaceResolver(scoped);
      return scoped
        .map((r) => {
          const cells = Array.isArray(r.cellNames) ? r.cellNames.filter(Boolean) : [];
          return {
            key: r._id,
            idNo: r.idNo || r.submissionId || "—",
            date: r.dateOfDisposal ? dayjs(r.dateOfDisposal).format("MM/DD/YYYY") : "—",
            slf: r.slfName || r.lguCompanyName || "—",
            generator: r.lguCompanyName || "—",
            companyType: r.companyType || "—",
            region: place(r.companyRegion) || "—",
            province: place(r.companyProvince) || "—",
            municipality: place(r.companyMunicipality) || "—",
            address: r.address || "—",
            trucks: r.truckCount ?? (r.trucks?.length || 0),
            // tonsFromMetricPair, not the raw tons field: the pair is kept in
            // lockstep by computeSlfMetrics, but records written before both
            // sides were populated carry 0 tons against a real m³ figure and
            // would otherwise report as no waste at all.
            volumeTons: num(tonsFromMetricPair(r.totalVolumeM3, r.totalVolumeTons)),
            residualTons: num(tonsFromMetricPair(r.residualVolumeM3, r.residualVolumeTons)),
            hazardousTons: num(tonsFromMetricPair(r.hazardousVolumeM3, r.hazardousVolumeTons)),
            unit: (r.baselineUnit || "m³").replace("m3", "m³"),
            cells: cells.join(", ") || "Unplaced",
            submittedBy: r.submittedBy || "—",
            status: r.status || "pending",
          };
        });
    },
  },
  {
    key: "facilities",
    tab: "SLF Facility Reports",
    icon: <BankOutlined />,
    title: "SLF Facility Reports",
    description: "Sanitary landfill facilities with status, ownership, category and cell counts.",
    filters: ["operationalStatus", "search"],
    columns: [
      { title: "Facility / Province", key: "facility", width: "24%", render: (_, r) => <Stack main={r.lgu} subs={[r.province]} /> },
      {
        title: "Status / Profile",
        key: "status",
        width: "18%",
        render: (_, r) => (
          <Stack
            main={<Tag color={/non/i.test(r.status) ? "red" : /oper/i.test(r.status) ? "green" : "default"} style={{ marginInlineEnd: 0 }}>{r.status || "—"}</Tag>}
            subs={[joinDot(r.ownership, r.category)]}
          />
        ),
      },
      {
        title: "Capacity",
        key: "capacity",
        width: "26%",
        render: (_, r) => (
          <Stack main={<>Total: {r.capacity}</>} subs={[`Receiving: ${r.receivingCapacity}`, `Waste received: ${r.wasteReceived}`]} />
        ),
      },
      {
        title: "Infrastructure",
        key: "infra",
        width: "18%",
        render: (_, r) => (
          <Stack main={`${r.cells} cell(s)`} subs={[`${r.leachate} leachate pond(s)`, `${r.gasVents} gas vent(s)`]} />
        ),
      },
      { title: "LGUs Served", dataIndex: "lgusServed", align: "right", width: "8%" },
      { title: "Year", dataIndex: "year", align: "right", width: "6%" },
    ],
    run: async ({ operationalStatus, search }) => {
      const { data } = await api.get("/slf-facilities/stats");
      const rows = Array.isArray(data?.managementData) ? data.managementData : [];
      const place = await buildPlaceResolver(rows.map((r) => ({ companyProvince: r.province })));
      const isOp = (s) => /operational/i.test(String(s || "")) && !/non/i.test(String(s || ""));
      const isNon = (s) => /non/i.test(String(s || ""));
      const withUnit = (val, unit) =>
        val != null && val !== "" ? `${Number(val).toLocaleString()} ${(unit || "m³").replace("m3", "m³")}` : "—";
      return rows
        .filter((r) => {
          if (operationalStatus === "Operational") return isOp(r.statusOfSLF);
          if (operationalStatus === "Non-Operational") return isNon(r.statusOfSLF);
          return true;
        })
        .filter((r) => (search ? String(r.lgu || "").toLowerCase().includes(search.toLowerCase()) : true))
        .map((r) => ({
          key: r._id || r.lgu,
          lgu: r.lgu || "—",
          province: place(r.province) || "—",
          status: r.statusOfSLF || "—",
          ownership: r.ownership || "—",
          category: r.category || "—",
          cells: r.numberOfCell || 0,
          capacity: withUnit(r.volumeCapacity, r.volumeCapacityUnit),
          receivingCapacity: withUnit(r.receivingVolumeCapacity, r.receivingVolumeCapacityUnit),
          wasteReceived: withUnit(r.actualResidualWasteReceived, r.volumeCapacityUnit),
          lgusServed: r.noOfLGUServed ?? 0,
          leachate: r.noOfLeachatePond ?? 0,
          gasVents: r.numberOfGasVents ?? 0,
          year: r.dataYear ?? "—",
        }));
    },
  },
  {
    key: "clients",
    tab: "Client & Sector Reports",
    icon: <TeamOutlined />,
    title: "Client & Sector Reports",
    description: "Distinct clients declared in SLF baselines, classified LGU / Private / Unclassified.",
    filters: ["clientType", "search"],
    columns: [
      {
        title: "Client / Type",
        key: "client",
        width: "30%",
        render: (_, r) => (
          <Stack
            main={r.name}
            subs={[<Tag key="t" color={r.type === "LGU" ? "blue" : r.type === "Private" ? "purple" : "default"} style={{ marginTop: 2 }}>{r.type}</Tag>]}
          />
        ),
      },
      { title: "Portal User(s)", dataIndex: "portalUsers", width: "28%" },
      { title: "SLF Facility(ies)", dataIndex: "slfs", width: "30%" },
      { title: "Relationships", dataIndex: "relationships", align: "right", width: "12%" },
    ],
    summary: (rows) => {
      const c = countClientsByType(rows.map((r) => ({ type: r.type })));
      return [
        { label: "Total", value: c.total },
        { label: "LGU", value: c.lgu, color: "#1677ff" },
        { label: "Private", value: c.private, color: "#722ed1" },
        { label: "Unclassified", value: c.unclassified, color: "#8c8c8c" },
      ];
    },
    run: async ({ clientType, search }) => {
      const { data } = await api.get("/data-slf/baselines");
      const rows = Array.isArray(data) ? data : data?.data || [];
      return aggregateHaulerClients(rows)
        .filter((c) => (clientType && clientType !== "all" ? classifyClientType(c.type) === clientType : true))
        .filter((c) => (search ? c.name.toLowerCase().includes(search.toLowerCase()) : true))
        .map((c) => ({
          key: c.key,
          name: c.name,
          type: c.type,
          portalUsers: c.portalUsers.join(", ") || "—",
          slfs: c.slfs.join(", ") || "—",
          relationships: c.userCount || c.portalUsers.length || 0,
        }));
    },
  },
  {
    key: "waste",
    tab: "Disposal & Waste Reports",
    icon: <CarOutlined />,
    title: "Disposal & Waste Reports",
    description: "Per-SLF disposal totals — submissions, trucks and residual vs hazardous volume.",
    filters: ["search"],
    columns: [
      { title: "SLF", dataIndex: "slf", width: "26%" },
      {
        title: "Activity",
        key: "activity",
        width: "20%",
        render: (_, r) => (
          <Stack main={`${r.submissions} submission(s)`} subs={[`${r.trucks} truck(s) · ${r.generatorCount} generator(s)`]} />
        ),
      },
      // One unit, tons — see the Submission Reports columns above.
      {
        title: "Waste (tons)",
        key: "waste",
        width: "22%",
        render: (_, r) => (
          <Stack main={<strong>{r.totalTons}</strong>} subs={[`Residual ${r.residualTons}`, `Hazardous ${r.hazardousTons}`]} />
        ),
      },
      {
        title: "Review Status",
        key: "review",
        width: "18%",
        render: (_, r) => (
          <Stack main={`${r.acknowledged} acknowledged`} subs={[`${r.pending} pending`, r.rejected ? `${r.rejected} rejected` : null, r.reverted ? `${r.reverted} reverted` : null]} />
        ),
      },
      { title: "Last Disposal", dataIndex: "lastDisposal", width: "14%" },
    ],
    run: async ({ search }) => {
      const { data } = await api.get("/data-slf/summary-by-slf");
      const rows = Array.isArray(data) ? data : data?.data || data?.rows || [];
      const num = (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
      return rows
        .filter((r) => (search ? String(r.slfName || r._id || "").toLowerCase().includes(search.toLowerCase()) : true))
        .map((r, i) => ({
          key: r._id || r.slfName || i,
          slf: r.slfName || r._id || "—",
          submissions: r.submissions || 0,
          trucks: r.trucks || 0,
          residualTons: num(tonsFromMetricPair(r.residualM3, r.residualTons)),
          hazardousTons: num(tonsFromMetricPair(r.hazardousM3, r.hazardousTons)),
          totalTons: num(tonsFromMetricPair(r.totalM3, r.totalTons)),
          pending: r.pending || 0,
          acknowledged: r.acknowledged || 0,
          rejected: r.rejected || 0,
          reverted: r.reverted || 0,
          generatorCount: Array.isArray(r.generators) ? r.generators.length : 0,
          lastDisposal: r.lastDisposalDate ? dayjs(r.lastDisposalDate).format("MM/DD/YYYY") : "—",
        }));
    },
  },
  {
    key: "portalUsers",
    tab: "Portal User Reports",
    icon: <UserOutlined />,
    title: "Portal User Reports",
    description: "SLF portal accounts with company and assigned facility.",
    filters: ["search"],
    columns: [
      { title: "User / Contact", key: "user", width: "26%", render: (_, r) => <Stack main={r.name} subs={[r.email, r.contact]} /> },
      { title: "Company / Assigned SLF", key: "company", width: "28%", render: (_, r) => <Stack main={r.company} subs={[r.slf]} /> },
      {
        title: "Status",
        key: "status",
        width: "16%",
        render: (_, r) => (
          <Stack main={<Tag color={statusColor(r.status)} style={{ marginInlineEnd: 0 }}>{r.status || "—"}</Tag>} subs={[`Verification: ${r.verification}`]} />
        ),
      },
      { title: "Access", dataIndex: "access", width: "18%" },
      { title: "Registered", dataIndex: "registered", width: "12%" },
    ],
    run: async ({ search }) => {
      const { data } = await api.get("/portal-users");
      const rows = Array.isArray(data) ? data : data?.data || [];
      return rows
        .filter((u) => {
          if (!search) return true;
          const q = search.toLowerCase();
          return [u.firstName, u.lastName, u.email, u.companyName].some((v) => String(v || "").toLowerCase().includes(q));
        })
        .map((u) => ({
          key: u._id || u.email,
          name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.username || "—",
          email: u.email || "—",
          company: u.companyName || "—",
          slf: (Array.isArray(u.assignedSlfName) ? u.assignedSlfName.join(", ") : u.slfName || u.assignedSlfName || u.assignedSlf) || "—",
          status: u.status || "—",
          verification: u.verificationRequired ? "Required" : u.verificationSubmitted ? "Submitted" : "Verified",
          contact: u.contactNumber || u.phone || u.mobile || "—",
          access: [
            u.portalAccess?.canSubmitDisposal !== false ? "Submit" : "No Submit",
            u.portalAccess?.canEditBaseline !== false ? "Baseline" : "No Baseline",
            u.portalAccess?.canUploadExcel !== false ? "Excel" : "No Excel",
          ].join(" / "),
          role: u.role || "portal",
          registered: u.createdAt ? dayjs(u.createdAt).format("MM/DD/YYYY") : "—",
        }));
    },
  },
];

function ReportControls({ report, filters, setFilters }) {
  const has = (k) => report.filters.includes(k);
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  return (
    <Space wrap size={8}>
      {has("dateRange") && (
        <RangePicker size="small" value={filters.dateRange} onChange={(v) => set("dateRange", v)} allowClear />
      )}
      {has("status") && (
        <Select
          size="small"
          style={{ minWidth: 150 }}
          value={filters.status || "all"}
          onChange={(v) => set("status", v)}
          options={[
            { label: "All statuses", value: "all" },
            { label: "Pending", value: "pending" },
            { label: "Acknowledged", value: "acknowledged" },
            { label: "Rejected", value: "rejected" },
            { label: "Reverted", value: "reverted" },
          ]}
        />
      )}
      {has("operationalStatus") && (
        <Select
          size="small"
          style={{ minWidth: 160 }}
          value={filters.operationalStatus || "all"}
          onChange={(v) => set("operationalStatus", v)}
          options={[
            { label: "All facilities", value: "all" },
            { label: "Operational", value: "Operational" },
            { label: "Non-Operational", value: "Non-Operational" },
          ]}
        />
      )}
      {has("clientType") && (
        <Select
          size="small"
          style={{ minWidth: 150 }}
          value={filters.clientType || "all"}
          onChange={(v) => set("clientType", v)}
          options={[
            { label: "All client types", value: "all" },
            { label: "LGU", value: "LGU" },
            { label: "Private", value: "Private" },
            { label: "Unclassified", value: "Unclassified" },
          ]}
        />
      )}
      {has("search") && (
        <Input.Search
          size="small"
          allowClear
          placeholder="Search"
          style={{ width: 200 }}
          value={filters.search}
          onChange={(e) => set("search", e.target.value)}
        />
      )}
    </Space>
  );
}

function ReportTab({ report }) {
  const [filters, setFilters] = useState({});
  const [state, setState] = useState({ status: "idle", rows: [] });

  const run = useCallback(async () => {
    setState({ status: "loading", rows: [] });
    try {
      const rows = await report.run(filters);
      setState({ status: rows.length ? "success" : "empty", rows });
    } catch (e) {
      setState({ status: "error", rows: [], error: e?.message || "Failed to generate report" });
    }
  }, [report, filters]);

  const exportRows = () => {
    if (!state.rows.length) return;
    const flat = state.rows.map(({ key, ...rest }) => rest); // drop internal key
    exportToExcel(flat, `${report.key}-report-${dayjs().format("YYYYMMDD")}`, report.title.slice(0, 28));
  };

  const summary = report.summary && state.status === "success" ? report.summary(state.rows) : null;
  const columns = useMemo(() => fitColumns(report.columns), [report.columns]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <Title level={5} style={{ margin: 0 }}>{report.icon} {report.title}</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>{report.description}</Text>
        </div>
        <Space wrap>
          <Button type="primary" icon={<ThunderboltOutlined />} onClick={run} loading={state.status === "loading"}>
            Generate Preview
          </Button>
          <Button icon={<DownloadOutlined />} onClick={exportRows} disabled={state.status !== "success"}>
            Export
          </Button>
        </Space>
      </div>

      <Card size="small" style={{ borderRadius: 8, marginBottom: 12 }} bodyStyle={{ padding: "10px 12px" }}>
        <ReportControls report={report} filters={filters} setFilters={setFilters} />
      </Card>

      {summary && (
        <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
          {summary.map((s) => (
            <Col xs={12} md={6} key={s.label}>
              <Card size="small" style={{ borderRadius: 8 }}>
                <Statistic title={s.label} value={s.value} valueStyle={{ color: s.color, fontSize: 20 }} />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {state.status === "idle" && (
        <Empty description="Select filters and click Generate Preview." />
      )}
      {state.status === "loading" && <Skeleton active paragraph={{ rows: 6 }} />}
      {state.status === "error" && (
        <Alert type="error" showIcon message="Could not generate report" description={state.error} />
      )}
      {state.status === "empty" && <Empty description="No records match the selected filters." />}
      {state.status === "success" && (
        <Card size="small" style={{ borderRadius: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>{state.rows.length} record(s)</Text>
          <Table
            size="small"
            style={{ marginTop: 8 }}
            dataSource={state.rows}
            columns={columns}
            rowKey="key"
            // Fixed layout + percentage widths: the table takes the page width
            // and wraps text. The pixel floor only engages on phone widths,
            // where squeezing seven columns would be unreadable.
            tableLayout="fixed"
            scroll={{ x: 720 }}
            pagination={{ pageSize: 15, showSizeChanger: true, showTotal: (t) => `${t} rows` }}
          />
        </Card>
      )}
    </div>
  );
}

// "Existing PDF Report" — preserves the SlfSubmissionReport generator. Its data is
// heavy, so it is fetched only when the admin opens the report (never on page load).
function ExistingPdfReportTab() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState(null);

  const launch = async () => {
    setLoading(true);
    try {
      const [tilesRes, rowsRes, facRes, baseRes, usersRes, annRes, txnRes, occRes] = await Promise.all([
        api.get("/data-slf/summary-tiles").catch(() => ({ data: null })),
        api.get("/data-slf/summary-by-slf").catch(() => ({ data: [] })),
        api.get("/slf-facilities/stats").catch(() => ({ data: {} })),
        api.get("/data-slf/baselines").catch(() => ({ data: [] })),
        api.get("/portal-users").catch(() => ({ data: [] })),
        // Current portal announcement(s) + recent portal/admin changes so the report
        // reflects the latest state, not just static submission data.
        api.get("/settings/app/portal-announcements").catch(() => ({ data: [] })),
        api.get("/transactions", { params: { limit: 25 } }).catch(() => ({ data: [] })),
        // The per-cell rollup the report's cell sections read (same source as
        // Submission Summary). It used to be omitted here.
        api.get("/data-slf/cell-occupancy").catch(() => ({ data: {} })),
      ]);
      const slfRows = Array.isArray(rowsRes.data) ? rowsRes.data : rowsRes.data?.data || [];
      const baselines = Array.isArray(baseRes.data) ? baseRes.data : baseRes.data?.data || [];
      const facilities = facRes.data?.managementData || [];
      const portalUsers = Array.isArray(usersRes.data) ? usersRes.data : usersRes.data?.data || [];
      const annData = annRes.data;
      const announcements = Array.isArray(annData) ? annData : annData?.items || annData?.data || (annData ? [annData] : []);
      const txnData = txnRes.data;
      const recentChanges = Array.isArray(txnData) ? txnData : txnData?.data || txnData?.items || [];
      setPayload({
        tiles: tilesRes.data, slfRows, facilities, baselines, portalUsers,
        totals: tilesRes.data, announcements, recentChanges,
        cellOccupancy: occRes.data?.byFacility || {},
      });
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Title level={5} style={{ margin: 0 }}><FilePdfOutlined /> Existing PDF Report</Title>
      <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
        The full SLF submission summary PDF report. Data is loaded only when you open it.
      </Paragraph>
      <Button type="primary" icon={<FilePdfOutlined />} loading={loading} onClick={launch}>
        Open PDF Report
      </Button>
      {open && payload && (
        <Suspense fallback={null}>
          <SlfSubmissionReport
            open={open}
            onClose={() => setOpen(false)}
            tiles={payload.tiles}
            slfRows={payload.slfRows}
            portalUsers={payload.portalUsers}
            facilities={payload.facilities}
            baselines={payload.baselines}
            totals={payload.totals}
            announcements={payload.announcements}
            recentChanges={payload.recentChanges}
            cellOccupancy={payload.cellOccupancy}
          />
        </Suspense>
      )}
    </div>
  );
}

export default function GenerateReports() {
  const items = useMemo(
    () => [
      ...REPORTS.map((r) => ({
        key: r.key,
        label: <span>{r.icon} {r.tab}</span>,
        children: <ReportTab report={r} />,
      })),
      {
        key: "dashboard-summary",
        label: <span><DashboardOutlined /> Dashboard Summary</span>,
        children: <ReportTab report={{
          key: "dashboard-summary",
          icon: <DashboardOutlined />,
          title: "Dashboard Summary Reports",
          description: "Top-line submission and waste KPIs across all SLFs.",
          filters: [],
          columns: [
            { title: "Metric", dataIndex: "metric" },
            { title: "Value", dataIndex: "value", align: "right" },
          ],
          run: async () => {
            const { data } = await api.get("/data-slf/summary-tiles");
            const d = data || {};
            return [
              ["Submissions", d.submissions],
              ["Truck Entries", d.trucks],
              // Reported in tons, like every other volume in this screen.
              ["Total Volume (tons)", tonsFromMetricPair(d.totalM3, d.totalTons)],
              ["Residual (tons)", tonsFromMetricPair(d.residualM3, d.residualTons)],
              ["Hazardous (tons)", tonsFromMetricPair(d.hazardousM3, d.hazardousTons)],
              ["Pending", d.statuses?.pending],
              ["Acknowledged", d.statuses?.acknowledged],
              ["LGU Submissions", d.companyTypes?.LGU],
              ["Private Submissions", d.companyTypes?.Private],
            ].map(([metric, value], i) => ({
              key: i, metric, value: Number(value || 0).toLocaleString(),
            }));
          },
        }} />,
      },
      {
        key: "existing-pdf",
        label: <span><FilePdfOutlined /> Existing PDF Report</span>,
        children: <ExistingPdfReportTab />,
      },
    ],
    [],
  );

  return (
    <div style={{ padding: 0 }}>
      <div style={{ marginBottom: 12 }}>
        <Title level={3} style={{ margin: 0 }}>Generate Reports</Title>
        <Text type="secondary">
          Generate and export reports across submissions, facilities, clients, waste and portal users.
          Data is fetched only when you generate a preview.
        </Text>
      </div>
      <Tabs items={items} />
    </div>
  );
}
