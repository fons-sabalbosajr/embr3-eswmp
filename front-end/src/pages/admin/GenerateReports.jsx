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
      { title: "Type", dataIndex: "companyType", width: 90 },
      { title: "Province", dataIndex: "province", ellipsis: true },
      { title: "Trucks", dataIndex: "trucks", align: "right" },
      { title: "Volume (m³)", dataIndex: "volumeM3", align: "right" },
      { title: "Volume (tons)", dataIndex: "volumeTons", align: "right" },
      { title: "Residual (m³)", dataIndex: "residualM3", align: "right" },
      { title: "Hazardous (m³)", dataIndex: "hazardousM3", align: "right" },
      { title: "Unit", dataIndex: "unit", width: 70 },
      { title: "Cell(s)", dataIndex: "cells", ellipsis: true },
      { title: "Submitted By", dataIndex: "submittedBy", ellipsis: true },
      { title: "Status", dataIndex: "status", render: (v) => <Tag>{v}</Tag> },
    ],
    run: async ({ dateRange, status, search }) => {
      // includeTrucks so the report carries the RELATED detail (cell placement,
      // waste split), not just the top-line volume. Paged, because that detail is
      // what makes the full set too large to return in one response.
      const rows = await fetchAllSubmissions({ includeTrucks: "true" });
      const num = (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
      return rows
        .filter((r) => inRange(r.dateOfDisposal, dateRange))
        .filter((r) => (status && status !== "all" ? r.status === status : true))
        .filter((r) => {
          if (!search) return true;
          const q = search.toLowerCase();
          return [r.idNo, r.slfName, r.lguCompanyName, r.submittedBy]
            .some((v) => String(v || "").toLowerCase().includes(q));
        })
        .map((r) => {
          const cells = [
            ...new Set(
              (Array.isArray(r.trucks) ? r.trucks : [])
                .flatMap((t) => [t?.cellName, ...((t?.vehicles || []).map((v) => v?.cellName))])
                .filter(Boolean),
            ),
          ];
          return {
            key: r._id,
            idNo: r.idNo || r.submissionId || "—",
            date: r.dateOfDisposal ? dayjs(r.dateOfDisposal).format("MM/DD/YYYY") : "—",
            slf: r.slfName || r.lguCompanyName || "—",
            generator: r.lguCompanyName || "—",
            companyType: r.companyType || "—",
            region: r.companyRegion || "—",
            province: r.companyProvince || "—",
            municipality: r.companyMunicipality || "—",
            address: r.address || "—",
            trucks: r.truckCount ?? (r.trucks?.length || 0),
            volumeM3: num(r.totalVolumeM3),
            volumeTons: num(r.totalVolumeTons),
            residualM3: num(r.residualVolumeM3),
            hazardousM3: num(r.hazardousVolumeM3),
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
      { title: "LGU / SLF", dataIndex: "lgu", ellipsis: true },
      { title: "Province", dataIndex: "province", ellipsis: true },
      { title: "Status", dataIndex: "status", render: (v) => <Tag color={/non/i.test(v) ? "red" : /oper/i.test(v) ? "green" : "default"}>{v || "—"}</Tag> },
      { title: "Ownership", dataIndex: "ownership" },
      { title: "Category", dataIndex: "category" },
      { title: "Cells", dataIndex: "cells", align: "right" },
      { title: "Capacity", dataIndex: "capacity", align: "right", ellipsis: true },
      { title: "Receiving Capacity", dataIndex: "receivingCapacity", align: "right", ellipsis: true },
      { title: "Waste Received", dataIndex: "wasteReceived", align: "right", ellipsis: true },
      { title: "LGUs Served", dataIndex: "lgusServed", align: "right" },
      { title: "Leachate Ponds", dataIndex: "leachate", align: "right" },
      { title: "Gas Vents", dataIndex: "gasVents", align: "right" },
      { title: "Year", dataIndex: "year", align: "right" },
    ],
    run: async ({ operationalStatus, search }) => {
      const { data } = await api.get("/slf-facilities/stats");
      const rows = Array.isArray(data?.managementData) ? data.managementData : [];
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
          province: r.province || "—",
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
      { title: "Client", dataIndex: "name", ellipsis: true },
      { title: "Type", dataIndex: "type", render: (v) => <Tag color={v === "LGU" ? "blue" : v === "Private" ? "purple" : "default"}>{v}</Tag> },
      { title: "Portal User(s)", dataIndex: "portalUsers", ellipsis: true },
      { title: "SLF Facility(ies)", dataIndex: "slfs", ellipsis: true },
      { title: "Relationship Count", dataIndex: "relationships", align: "right" },
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
      { title: "SLF", dataIndex: "slf", ellipsis: true },
      { title: "Submissions", dataIndex: "submissions", align: "right" },
      { title: "Trucks", dataIndex: "trucks", align: "right" },
      { title: "Residual (m³)", dataIndex: "residual", align: "right" },
      { title: "Hazardous (m³)", dataIndex: "hazardous", align: "right" },
      { title: "Total (m³)", dataIndex: "total", align: "right" },
      { title: "Total (tons)", dataIndex: "totalTons", align: "right" },
      { title: "Pending", dataIndex: "pending", align: "right" },
      { title: "Acknowledged", dataIndex: "acknowledged", align: "right" },
      { title: "Generators", dataIndex: "generatorCount", align: "right" },
      { title: "Last Disposal", dataIndex: "lastDisposal" },
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
          residual: num(r.residualM3),
          hazardous: num(r.hazardousM3),
          total: num(r.totalM3),
          residualTons: num(r.residualTons),
          hazardousTons: num(r.hazardousTons),
          totalTons: num(r.totalTons),
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
      { title: "Name", dataIndex: "name", ellipsis: true },
      { title: "Email", dataIndex: "email", ellipsis: true },
      { title: "Company", dataIndex: "company", ellipsis: true },
      { title: "Assigned SLF", dataIndex: "slf", ellipsis: true },
      { title: "Status", dataIndex: "status", render: (v) => <Tag color={/approved/i.test(v) ? "green" : /pending/i.test(v) ? "orange" : /reject|suspend/i.test(v) ? "red" : "default"}>{v || "—"}</Tag> },
      { title: "Verification", dataIndex: "verification", width: 120 },
      { title: "Contact", dataIndex: "contact", ellipsis: true },
      { title: "Access", dataIndex: "access", ellipsis: true },
      { title: "Registered", dataIndex: "registered" },
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
      const [tilesRes, rowsRes, facRes, baseRes, usersRes, annRes, txnRes] = await Promise.all([
        api.get("/data-slf/summary-tiles").catch(() => ({ data: null })),
        api.get("/data-slf/summary-by-slf").catch(() => ({ data: [] })),
        api.get("/slf-facilities/stats").catch(() => ({ data: {} })),
        api.get("/data-slf/baselines").catch(() => ({ data: [] })),
        api.get("/portal-users").catch(() => ({ data: [] })),
        // Current portal announcement(s) + recent portal/admin changes so the report
        // reflects the latest state, not just static submission data.
        api.get("/settings/app/portal-announcements").catch(() => ({ data: [] })),
        api.get("/transactions", { params: { limit: 25 } }).catch(() => ({ data: [] })),
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
