import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, DatePicker, Drawer, Empty, Form, Input, Row, Select, Space, Statistic, Table, Tag, Typography, message } from "antd";
import { DownloadOutlined, EyeOutlined, LineChartOutlined, ReloadOutlined, SaveOutlined, SyncOutlined } from "@ant-design/icons";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import dayjs from "dayjs";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;
const emptySummary = { activeIssues: 0, resolvedIssues: 0, portalIssues: 0, adminIssues: 0, failedOperations: 0 };

const statusColor = (status) => {
  if (status === "resolved") return "green";
  if (status === "escalated" || status === "open") return "red";
  if (status === "awaiting_admin") return "orange";
  if (status === "awaiting_user") return "blue";
  if (status === "investigating") return "purple";
  return "default";
};

export default function VeraWorkarounds({ isDark }) {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(emptySummary);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [filters, setFilters] = useState({ search: "", source: "all", eventType: "all", status: "all", module: "all", facility: "", range: null });
  const [notesForm] = Form.useForm();

  const eventTypes = useMemo(() => ["all", ...new Set(items.map((item) => item.eventType).filter(Boolean))], [items]);
  const modules = useMemo(() => ["all", ...new Set(items.map((item) => item.module).filter(Boolean))], [items]);

  // Daily trend of VERA-detected issues (and how many were resolved) — derived from
  // the actual loaded logs, one point per calendar day, chronologically ordered.
  const dailyTrend = useMemo(() => {
    const byDay = new Map();
    for (const item of items) {
      if (!item.timestamp) continue;
      const d = dayjs(item.timestamp);
      if (!d.isValid()) continue;
      const key = d.format("YYYY-MM-DD");
      const row = byDay.get(key) || { key, issues: 0, resolved: 0 };
      row.issues += 1;
      if (item.resolutionStatus === "resolved") row.resolved += 1;
      byDay.set(key, row);
    }
    return [...byDay.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((r) => ({ ...r, label: dayjs(r.key).format("MMM D") }));
  }, [items]);

  const fetchLogs = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/vera/logs", {
        params: {
          search: filters.search || undefined,
          source: filters.source,
          eventType: filters.eventType,
          status: filters.status,
          module: filters.module,
          facility: filters.facility || undefined,
          from: filters.range?.[0]?.toISOString?.(),
          to: filters.range?.[1]?.toISOString?.(),
          limit: 500,
        },
      });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setSummary(data?.summary || emptySummary);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load VERA workarounds and logs.");
    } finally {
      setLoading(false);
    }
  };

  const scanBacklogs = async () => {
    setScanning(true);
    setError("");
    try {
      await api.post("/vera/backlogs/scan");
      await fetchLogs();
      message.success("VERA scan completed.");
    } catch (err) {
      setError(err.response?.data?.message || "Backlog scan failed.");
    } finally {
      setScanning(false);
    }
  };

  const saveResolution = async (status = "resolved") => {
    if (!detail || detail.sourceType !== "backlog") return;
    setSaving(true);
    try {
      const values = notesForm.getFieldsValue();
      await api.patch(`/vera/backlogs/${detail.recordId}/resolve`, { status, adminNotes: values.adminNotes || "" });
      message.success(status === "resolved" ? "VERA log marked resolved." : "Administrator notes saved.");
      setDetail(null);
      await fetchLogs();
    } catch (err) {
      message.error(err.response?.data?.message || "Could not update VERA log.");
    } finally {
      setSaving(false);
    }
  };

  const exportLogs = () => {
    const rows = items.map((item) => ({
      Timestamp: item.timestamp ? dayjs(item.timestamp).format("YYYY-MM-DD HH:mm") : "",
      Source: item.source,
      User: item.user,
      "SLF / Facility": item.facility,
      Module: item.module,
      "Event Type": item.eventType,
      "Issue Detected": item.issueDetected,
      "VERA Message / Action": item.veraMessage,
      "Recommended Workaround": item.recommendedWorkaround,
      "Resolution Status": item.resolutionStatus,
      "Resolved Date": item.resolvedDate ? dayjs(item.resolvedDate).format("YYYY-MM-DD HH:mm") : "",
      "Related Record": item.relatedRecordReference,
    }));
    if (!rows.length) return message.info("No VERA logs to export for the current filters.");
    exportToExcel(rows, `VERA_Workarounds_Logs_${dayjs().format("YYYY-MM-DD")}`);
  };

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const metricCards = [
    ["Active Issues", summary.activeIssues, "#fa8c16"],
    ["Resolved Issues", summary.resolvedIssues, "#52c41a"],
    ["Portal Issues", summary.portalIssues, "#1677ff"],
    ["Admin Issues", summary.adminIssues, "#722ed1"],
    ["Failed Operations", summary.failedOperations, "#ff4d4f"],
  ];

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16, borderRadius: 8 }}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Space align="start" style={{ justifyContent: "space-between", width: "100%" }} wrap>
            <div>
              <Title level={4} style={{ margin: 0, color: isDark ? "#f0f0f0" : undefined }}>VERA Workarounds and Logs</Title>
              <Text type="secondary">Actual VERA backlog detections and relevant application events from Admin and Portal sides.</Text>
            </div>
            <Space wrap>
              <Button icon={<ReloadOutlined />} onClick={fetchLogs} loading={loading}>Refresh</Button>
              <Button icon={<DownloadOutlined />} onClick={exportLogs}>Export</Button>
              <Button type="primary" icon={<SyncOutlined />} onClick={scanBacklogs} loading={scanning}>Scan Now</Button>
            </Space>
          </Space>
          <Row gutter={[12, 12]}>
            {metricCards.map(([title, value, color]) => (
              <Col xs={12} md={8} xl={4} key={title}>
                <Card size="small" style={{ borderRadius: 8, borderLeft: `3px solid ${color}` }}>
                  <Statistic title={title} value={value} valueStyle={{ color, fontSize: 20 }} />
                </Card>
              </Col>
            ))}
          </Row>
          <Row gutter={[8, 8]}>
            <Col xs={24} md={7}><Input.Search allowClear placeholder="Search logs" value={filters.search} onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))} onSearch={fetchLogs} /></Col>
            <Col xs={12} md={3}><Select value={filters.source} onChange={(v) => setFilters((p) => ({ ...p, source: v }))} style={{ width: "100%" }} options={["all", "Admin", "Portal"].map((v) => ({ label: v === "all" ? "All Sources" : v, value: v }))} /></Col>
            <Col xs={12} md={4}><Select value={filters.eventType} onChange={(v) => setFilters((p) => ({ ...p, eventType: v }))} style={{ width: "100%" }} options={eventTypes.map((v) => ({ label: v === "all" ? "All Event Types" : v, value: v }))} /></Col>
            <Col xs={12} md={4}><Select value={filters.module} onChange={(v) => setFilters((p) => ({ ...p, module: v }))} style={{ width: "100%" }} options={modules.map((v) => ({ label: v === "all" ? "All Modules" : v, value: v }))} /></Col>
            <Col xs={12} md={3}><Select value={filters.status} onChange={(v) => setFilters((p) => ({ ...p, status: v }))} style={{ width: "100%" }} options={[{ label: "All Status", value: "all" }, { label: "Open", value: "open" }, { label: "Resolved", value: "resolved" }]} /></Col>
            <Col xs={24} md={6}><Input allowClear placeholder="Facility" value={filters.facility} onChange={(e) => setFilters((p) => ({ ...p, facility: e.target.value }))} /></Col>
            <Col xs={24} md={8}><RangePicker style={{ width: "100%" }} value={filters.range} onChange={(range) => setFilters((p) => ({ ...p, range }))} /></Col>
            <Col xs={24} md={3}><Button block onClick={fetchLogs} loading={loading}>Apply</Button></Col>
          </Row>
        </Space>
      </Card>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}

      {/* Daily issue trend — issues VERA encountered per day (with resolved overlay). */}
      <Card
        size="small"
        style={{ marginBottom: 16, borderRadius: 8 }}
        title={
          <Space size={6}>
            <LineChartOutlined style={{ color: "#1677ff" }} />
            <Text strong style={{ color: isDark ? "#f0f0f0" : undefined }}>Daily Issue Trend</Text>
          </Space>
        }
      >
        {dailyTrend.length ? (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={dailyTrend} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#303030" : "#f0f0f0"} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: isDark ? "#bfbfbf" : "#595959" }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: isDark ? "#bfbfbf" : "#595959" }} />
              <RTooltip
                contentStyle={{
                  fontSize: 12,
                  background: isDark ? "#1f1f1f" : "#fff",
                  border: `1px solid ${isDark ? "#303030" : "#d9d9d9"}`,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="issues" name="Issues Detected" stroke="#fa8c16" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="resolved" name="Resolved" stroke="#52c41a" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No dated issues to chart yet" />
        )}
      </Card>

      {/* Compact table: smaller data font so more rows/columns are readable at once. */}
      <style>{`
        .vera-logs-table .ant-table { font-size: 11.5px; }
        .vera-logs-table .ant-table-thead > tr > th { font-size: 11.5px; padding: 6px 8px; }
        .vera-logs-table .ant-table-tbody > tr > td { padding: 5px 8px; }
        .vera-logs-table .ant-tag { font-size: 10.5px; line-height: 16px; padding: 0 5px; }
      `}</style>
      <Table
        className="vera-logs-table"
        size="small"
        loading={loading}
        rowKey="id"
        dataSource={items}
        pagination={{ pageSize: 12, showSizeChanger: true }}
        scroll={{ x: 1500 }}
        locale={{ emptyText: <Empty description="No VERA logs match the current filters" /> }}
        columns={[
          { title: "Timestamp", dataIndex: "timestamp", width: 150, sorter: (a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0), render: (v) => v ? dayjs(v).format("MMM D, YYYY HH:mm") : "—" },
          { title: "Source", dataIndex: "source", width: 90, filters: [{ text: "Admin", value: "Admin" }, { text: "Portal", value: "Portal" }], onFilter: (v, r) => r.source === v, render: (v) => <Tag color={v === "Portal" ? "blue" : "purple"}>{v}</Tag> },
          { title: "User", dataIndex: "user", width: 180, ellipsis: true, render: (v) => v || "—" },
          { title: "SLF / Facility", dataIndex: "facility", width: 180, ellipsis: true, render: (v) => v || "—" },
          { title: "Module", dataIndex: "module", width: 180, ellipsis: true },
          { title: "Event Type", dataIndex: "eventType", width: 180, render: (v) => <Tag>{v}</Tag> },
          { title: "Issue Detected", dataIndex: "issueDetected", width: 260, ellipsis: true },
          { title: "Recommended Workaround", dataIndex: "recommendedWorkaround", width: 280, ellipsis: true },
          { title: "Resolution", dataIndex: "resolutionStatus", width: 130, render: (v) => <Tag color={statusColor(v)}>{v}</Tag> },
          { title: "Actions", fixed: "right", width: 100, render: (_, record) => <Button size="small" icon={<EyeOutlined />} onClick={() => { setDetail(record); notesForm.setFieldsValue({ adminNotes: record.technicalDetails?.adminNotes || "" }); }}>Details</Button> },
        ]}
      />

      <Drawer title="VERA Log Details" open={!!detail} onClose={() => setDetail(null)} width={620}>
        {detail && (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Alert type={detail.resolutionStatus === "resolved" ? "success" : "warning"} showIcon message={detail.issueDetected || detail.eventType} description={detail.veraMessage} />
            <Card size="small"><pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(detail.technicalDetails || {}, null, 2)}</pre></Card>
            <Form form={notesForm} layout="vertical">
              <Form.Item name="adminNotes" label="Administrator Notes">
                <Input.TextArea rows={4} placeholder="Add resolution notes or investigation context" disabled={detail.sourceType !== "backlog"} />
              </Form.Item>
            </Form>
            {detail.sourceType === "backlog" ? (
              <Space>
                <Button icon={<SaveOutlined />} loading={saving} onClick={() => saveResolution("open")}>Save Notes</Button>
                <Button type="primary" loading={saving} onClick={() => saveResolution("resolved")}>Mark as Resolved</Button>
              </Space>
            ) : (
              <Alert type="info" showIcon message="AppLog entries are retained for diagnostics and cannot be resolved here." />
            )}
          </Space>
        )}
      </Drawer>
    </div>
  );
}
