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

const SlfSubmissionReport = lazy(() => import("./SlfSubmissionReport"));

const { Title, Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;

// ── Shared, lazily-fetched data (only requested when a tab first needs it) ──
const inRange = (date, range) => {
  if (!range || !range[0] || !range[1]) return true;
  const d = dayjs(date);
  return d.isValid() && !d.isBefore(range[0], "day") && !d.isAfter(range[1], "day");
};

// Each report declares only the filters it needs and a `run(filters)` that fetches
// from an EXISTING endpoint on demand (never on page load) and returns preview rows.
const REPORTS = [
  {
    key: "submissions",
    tab: "Submission Reports",
    icon: <FileTextOutlined />,
    title: "Submission Reports",
    description: "Portal disposal submissions with status, generator, trucks and volume.",
    filters: ["dateRange", "status", "search"],
    columns: [
      { title: "ID No.", dataIndex: "idNo" },
      { title: "Date", dataIndex: "date" },
      { title: "SLF", dataIndex: "slf", ellipsis: true },
      { title: "Generator", dataIndex: "generator", ellipsis: true },
      { title: "Trucks", dataIndex: "trucks", align: "right" },
      { title: "Volume (m³)", dataIndex: "volumeM3", align: "right" },
      { title: "Status", dataIndex: "status", render: (v) => <Tag>{v}</Tag> },
    ],
    run: async ({ dateRange, status, search }) => {
      const { data } = await api.get("/data-slf", { params: { mode: "list" } });
      const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      return rows
        .filter((r) => inRange(r.dateOfDisposal, dateRange))
        .filter((r) => (status && status !== "all" ? r.status === status : true))
        .filter((r) => {
          if (!search) return true;
          const q = search.toLowerCase();
          return [r.idNo, r.slfName, r.lguCompanyName, r.submittedBy]
            .some((v) => String(v || "").toLowerCase().includes(q));
        })
        .map((r) => ({
          key: r._id,
          idNo: r.idNo || r.submissionId || "—",
          date: r.dateOfDisposal ? dayjs(r.dateOfDisposal).format("MM/DD/YYYY") : "—",
          slf: r.slfName || r.lguCompanyName || "—",
          generator: r.lguCompanyName || "—",
          trucks: r.truckCount ?? (r.trucks?.length || 0),
          volumeM3: Number(r.totalVolumeM3 || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }),
          status: r.status || "pending",
        }));
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
      { title: "LGU / SLF", dataIndex: "lgu", ellipsis: true },
      { title: "Province", dataIndex: "province", ellipsis: true },
      { title: "Status", dataIndex: "status", render: (v) => <Tag color={/non/i.test(v) ? "red" : /oper/i.test(v) ? "green" : "default"}>{v || "—"}</Tag> },
      { title: "Ownership", dataIndex: "ownership" },
      { title: "Category", dataIndex: "category" },
      { title: "Cells", dataIndex: "cells", align: "right" },
    ],
    run: async ({ operationalStatus, search }) => {
      const { data } = await api.get("/slf-facilities/stats");
      const rows = Array.isArray(data?.managementData) ? data.managementData : [];
      const isOp = (s) => /operational/i.test(String(s || "")) && !/non/i.test(String(s || ""));
      const isNon = (s) => /non/i.test(String(s || ""));
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
          province: r.province || "—",
          status: r.statusOfSLF || "—",
          ownership: r.ownership || "—",
          category: r.category || "—",
          cells: r.numberOfCell || 0,
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
      { title: "Client", dataIndex: "name", ellipsis: true },
      { title: "Type", dataIndex: "type", render: (v) => <Tag color={v === "LGU" ? "blue" : v === "Private" ? "purple" : "default"}>{v}</Tag> },
      { title: "Portal User(s)", dataIndex: "portalUsers", ellipsis: true },
      { title: "SLF Facility(ies)", dataIndex: "slfs", ellipsis: true },
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
      { title: "SLF", dataIndex: "slf", ellipsis: true },
      { title: "Submissions", dataIndex: "submissions", align: "right" },
      { title: "Trucks", dataIndex: "trucks", align: "right" },
      { title: "Residual (m³)", dataIndex: "residual", align: "right" },
      { title: "Hazardous (m³)", dataIndex: "hazardous", align: "right" },
      { title: "Total (m³)", dataIndex: "total", align: "right" },
    ],
    run: async ({ search }) => {
      const { data } = await api.get("/data-slf/summary-by-slf");
      const rows = Array.isArray(data) ? data : data?.data || data?.rows || [];
      return rows
        .filter((r) => (search ? String(r.slfName || r._id || "").toLowerCase().includes(search.toLowerCase()) : true))
        .map((r, i) => ({
          key: r._id || r.slfName || i,
          slf: r.slfName || r._id || "—",
          submissions: r.submissions || 0,
          trucks: r.trucks || 0,
          residual: Number(r.residualM3 || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }),
          hazardous: Number(r.hazardousM3 || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }),
          total: Number(r.totalM3 || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }),
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
      { title: "Name", dataIndex: "name", ellipsis: true },
      { title: "Email", dataIndex: "email", ellipsis: true },
      { title: "Company", dataIndex: "company", ellipsis: true },
      { title: "Assigned SLF", dataIndex: "slf", ellipsis: true },
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
          slf: u.slfName || u.assignedSlf || "—",
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
            columns={report.columns}
            rowKey="key"
            scroll={{ x: "max-content" }}
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
      const [tilesRes, rowsRes, facRes, baseRes, usersRes] = await Promise.all([
        api.get("/data-slf/summary-tiles").catch(() => ({ data: null })),
        api.get("/data-slf/summary-by-slf").catch(() => ({ data: [] })),
        api.get("/slf-facilities/stats").catch(() => ({ data: {} })),
        api.get("/data-slf/baselines").catch(() => ({ data: [] })),
        api.get("/portal-users").catch(() => ({ data: [] })),
      ]);
      const slfRows = Array.isArray(rowsRes.data) ? rowsRes.data : rowsRes.data?.data || [];
      const baselines = Array.isArray(baseRes.data) ? baseRes.data : baseRes.data?.data || [];
      const facilities = facRes.data?.managementData || [];
      const portalUsers = Array.isArray(usersRes.data) ? usersRes.data : usersRes.data?.data || [];
      setPayload({ tiles: tilesRes.data, slfRows, facilities, baselines, portalUsers, totals: tilesRes.data });
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
              ["Total Volume (m³)", d.totalM3],
              ["Residual (m³)", d.residualM3],
              ["Hazardous (m³)", d.hazardousM3],
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
