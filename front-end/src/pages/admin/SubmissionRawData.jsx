// Submission RAW Data — developer-only maintenance tool.
//
// Two panes:
//   • Records  — paginated raw DataSLF records with server-side search/filter,
//                a validated edit form for the identifier fields, and soft
//                delete (hard delete requires typing the ID No.).
//   • Volume Analysis — submitted volume vs. cell capacity, analysed server-side.
//
// All data comes from /api/raw-submissions, which is developer-gated on the
// backend. Nothing here computes analysis over a full dataset in the browser.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  Table,
  Space,
  Tag,
  Button,
  Input,
  Select,
  Modal,
  Form,
  DatePicker,
  Typography,
  Tabs,
  Alert,
  Tooltip,
  Descriptions,
  Statistic,
  Row,
  Col,
  message,
  Popconfirm,
} from "antd";
import {
  DatabaseOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined,
  WarningOutlined,
  UndoOutlined,
  BarChartOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import api from "../../api";
import { withSizeChanger } from "../../utils/tablePagination";
import {
  CAPACITY_STATUS,
  CAPACITY_STATUS_OPTIONS,
  getCapacityStatus,
  getCellTypeConfig,
} from "../../utils/cellVisuals";

const { Text, Paragraph } = Typography;

const COMPANY_TYPES = [
  { label: "LGU", value: "LGU" },
  { label: "Private", value: "Private" },
];
const SUBMISSION_STATUSES = [
  "pending",
  "acknowledged",
  "rejected",
  "revert_requested",
  "reverted",
].map((v) => ({ label: v, value: v }));

const fmt = (v) =>
  v == null || !Number.isFinite(Number(v)) ? "—" : parseFloat(Number(v).toFixed(2)).toLocaleString();

// Strip empty filter values so they never reach the query string.
const clean = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ""));

/* ══════════════════ Records pane ══════════════════ */

function RecordsPane({ options }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState({});
  const [searchText, setSearchText] = useState("");
  const [viewDoc, setViewDoc] = useState(null);
  const [editRow, setEditRow] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/raw-submissions", {
        params: clean({ ...filters, page, pageSize, includeDeleted: true }),
      });
      setRows(data.rows || []);
      setTotal(data.total || 0);
    } catch (err) {
      message.error(err.response?.data?.message || "Could not load raw submissions.");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // Debounce the free-text search so a keystroke doesn't fire a request each time.
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setFilters((f) => ({ ...f, submissionId: searchText.trim() || undefined }));
    }, 400);
    return () => clearTimeout(t);
  }, [searchText]);

  const setFilter = (key, value) => {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: value || undefined }));
  };

  const openEdit = async (row) => {
    try {
      const { data } = await api.get(`/raw-submissions/${row._id}`);
      setEditRow(data);
      form.setFieldsValue({
        ...data,
        dateOfDisposal: data.dateOfDisposal ? dayjs(data.dateOfDisposal) : null,
        slfGenerator: data.slfGenerator ? String(data.slfGenerator) : undefined,
      });
    } catch (err) {
      message.error(err.response?.data?.message || "Could not load the record.");
    }
  };

  const saveEdit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return; // form shows the field errors
    }
    setSaving(true);
    try {
      const payload = {
        ...values,
        dateOfDisposal: values.dateOfDisposal ? values.dateOfDisposal.toISOString() : undefined,
      };
      const { data } = await api.put(`/raw-submissions/${editRow._id}`, clean(payload));
      message.success(data.message || "Updated.");
      setEditRow(null);
      fetchRows();
    } catch (err) {
      const res = err.response?.data;
      // Surface per-field validation errors from the server verbatim.
      message.error(res?.errors?.length ? res.errors.join(" · ") : res?.message || "Update failed.");
    } finally {
      setSaving(false);
    }
  };

  const softDelete = async (row) => {
    try {
      const { data } = await api.delete(`/raw-submissions/${row._id}`);
      message.success(data.message);
      fetchRows();
    } catch (err) {
      message.error(err.response?.data?.message || "Delete failed.");
    }
  };

  const restore = async (row) => {
    try {
      const { data } = await api.post(`/raw-submissions/${row._id}/restore`);
      message.success(data.message);
      fetchRows();
    } catch (err) {
      message.error(err.response?.data?.message || "Restore failed.");
    }
  };

  // Hard delete is irreversible — the backend demands the record's own ID No.
  // echoed back, and so does this dialog.
  const hardDelete = (row) => {
    const expected = row.idNo || row._id;
    let typed = "";
    Modal.confirm({
      title: "Permanently delete this submission?",
      icon: <WarningOutlined style={{ color: "#ff4d4f" }} />,
      content: (
        <div>
          <Paragraph style={{ marginBottom: 8 }}>
            This cannot be undone. Prefer <Text strong>soft delete</Text>, which keeps the record
            recoverable. To confirm, type the ID No. <Text code>{expected}</Text>:
          </Paragraph>
          <Input placeholder={expected} onChange={(e) => { typed = e.target.value; }} />
        </div>
      ),
      okText: "Permanently delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        if (typed !== expected) {
          message.error("The typed ID No. does not match.");
          throw new Error("confirmation mismatch");
        }
        const { data } = await api.delete(`/raw-submissions/${row._id}`, {
          params: { hard: true, confirm: expected },
        });
        message.success(data.message);
        fetchRows();
      },
    });
  };

  const columns = [
    {
      title: "ID No.",
      dataIndex: "idNo",
      key: "idNo",
      width: 170,
      render: (v, r) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ fontSize: 12 }}>{v || "—"}</Text>
          {r.deletedAt && <Tag color="red" style={{ fontSize: 10 }}>DELETED</Tag>}
          {r.isDummy && <Tag color="purple" style={{ fontSize: 10 }}>SAMPLE</Tag>}
        </Space>
      ),
    },
    { title: "SLF", dataIndex: "slfName", key: "slfName", width: 190, ellipsis: true },
    { title: "LGU / Company", dataIndex: "lguCompanyName", key: "lguCompanyName", width: 190, ellipsis: true },
    {
      title: "Type",
      dataIndex: "companyType",
      key: "companyType",
      width: 90,
      render: (v) => <Tag color={v === "LGU" ? "blue" : "geekblue"}>{v || "—"}</Tag>,
    },
    {
      title: "Disposal Date",
      dataIndex: "dateOfDisposal",
      key: "dateOfDisposal",
      width: 120,
      render: (v) => (v ? dayjs(v).format("YYYY-MM-DD") : "—"),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 130,
      render: (v) => <Tag>{v || "—"}</Tag>,
    },
    {
      title: "Trucks",
      dataIndex: "truckCount",
      key: "truckCount",
      width: 80,
      align: "center",
      render: (v) => Number(v || 0).toLocaleString(),
    },
    {
      title: "Actions",
      key: "actions",
      fixed: "right",
      width: 190,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="Inspect raw record">
            <Button size="small" icon={<EyeOutlined />} onClick={() => setViewDoc(r)} />
          </Tooltip>
          <Tooltip title="Correct fields">
            <Button size="small" type="primary" ghost icon={<EditOutlined />} onClick={() => openEdit(r)} />
          </Tooltip>
          {r.deletedAt ? (
            <Tooltip title="Restore">
              <Button size="small" icon={<UndoOutlined />} onClick={() => restore(r)} />
            </Tooltip>
          ) : (
            <Popconfirm title="Soft-delete this submission?" onConfirm={() => softDelete(r)}>
              <Tooltip title="Soft delete (recoverable)">
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
          <Tooltip title="Permanent delete">
            <Button size="small" danger type="text" onClick={() => hardDelete(r)}>
              Purge
            </Button>
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="Developer maintenance tool"
        description="Edits here write directly to raw submission records. Every change is recorded in the submission's audit trail (previous → new value). System-managed fields (audit metadata, revert state, computed volume metrics, trucks) are not editable."
      />

      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          allowClear
          placeholder="Search ID No. / submission ID"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 240 }}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="SLF"
          style={{ width: 200 }}
          value={filters.slfGenerator}
          onChange={(v) => setFilter("slfGenerator", v)}
          options={(options.facilities || []).map((f) => ({ label: f.name, value: f._id }))}
        />
        <Select
          allowClear
          placeholder="LGU / PVT"
          style={{ width: 120 }}
          value={filters.companyType}
          onChange={(v) => setFilter("companyType", v)}
          options={COMPANY_TYPES}
        />
        <Select
          allowClear
          placeholder="Year"
          style={{ width: 110 }}
          value={filters.year}
          onChange={(v) => setFilter("year", v)}
          options={(options.years || []).map((y) => ({ label: String(y), value: y }))}
        />
        <Select
          allowClear
          placeholder="Month"
          style={{ width: 110 }}
          value={filters.month}
          onChange={(v) => setFilter("month", v)}
          options={Array.from({ length: 12 }, (_, i) => ({
            label: dayjs().month(i).format("MMMM"),
            value: i + 1,
          }))}
        />
        <Select
          allowClear
          placeholder="Status"
          style={{ width: 150 }}
          value={filters.status}
          onChange={(v) => setFilter("status", v)}
          options={(options.statuses || []).map((s) => ({ label: s, value: s }))}
        />
        <Button icon={<ReloadOutlined />} loading={loading} onClick={fetchRows}>
          Refresh
        </Button>
      </Space>

      <Table
        size="small"
        rowKey="_id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1160 }}
        rowClassName={(r) => (r.deletedAt ? "raw-row-deleted" : "")}
        pagination={withSizeChanger({
          current: page,
          pageSize,
          total,
          size: "small",
          showTotal: (t) => `${t.toLocaleString()} submission${t === 1 ? "" : "s"}`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        })}
      />

      {/* Raw document inspector */}
      <Modal
        open={!!viewDoc}
        onCancel={() => setViewDoc(null)}
        footer={<Button onClick={() => setViewDoc(null)}>Close</Button>}
        width={860}
        title={<Space><DatabaseOutlined /> Raw record — {viewDoc?.idNo}</Space>}
      >
        {viewDoc && <RawInspector id={viewDoc._id} />}
      </Modal>

      {/* Validated edit form — only the editable identifier/classification fields */}
      <Modal
        open={!!editRow}
        onCancel={() => setEditRow(null)}
        onOk={saveEdit}
        okText="Save changes"
        okButtonProps={{ loading: saving, danger: true }}
        width={760}
        title={<Space><EditOutlined /> Correct submission — {editRow?.idNo}</Space>}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="A changed ID No. is kept in previousIdNos, and re-pointing slfGenerator is checked against a real facility."
        />
        <Form form={form} layout="vertical" size="small">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="idNo"
                label="ID No."
                rules={[{ pattern: /^[A-Za-z0-9-]*$/, message: "Letters, digits and dashes only" }]}
              >
                <Input placeholder="SLF-PVT-BA-0001" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="submissionId" label="Submission ID">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="slfGenerator" label="SLF Facility (slfGenerator)">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="Unlinked"
                  options={(options.facilities || []).map((f) => ({ label: f.name, value: f._id }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="slfName" label="SLF Name">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="lguCompanyName" label="LGU / Company Name">
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="companyType" label="Company Type">
                <Select options={COMPANY_TYPES} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="status" label="Status">
                <Select options={SUBMISSION_STATUSES} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="dateOfDisposal" label="Date of Disposal">
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="submittedBy" label="Submitted By">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="companyProvince" label="Province">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="companyMunicipality" label="Municipality">
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="address" label="Address">
                <Input />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
}

// Full raw document, fetched on demand (the list payload is projected).
function RawInspector({ id }) {
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .get(`/raw-submissions/${id}`)
      .then(({ data }) => alive && setDoc(data))
      .catch(() => alive && setDoc(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  if (loading) return <Text type="secondary">Loading…</Text>;
  if (!doc) return <Text type="danger">Could not load the record.</Text>;

  return (
    <pre
      style={{
        maxHeight: 520,
        overflow: "auto",
        fontSize: 11,
        background: "rgba(0,0,0,0.04)",
        padding: 12,
        borderRadius: 8,
        margin: 0,
      }}
    >
      {JSON.stringify(doc, null, 2)}
    </pre>
  );
}

/* ══════════════════ Volume Analysis pane ══════════════════ */

function VolumeAnalysisPane({ options, onInspect }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState({ sortBy: "utilizationPercentage", sortDir: "desc" });

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/raw-submissions/volume-analysis", {
        params: clean({ ...filters, ...sort, page, pageSize }),
      });
      setRows(data.rows || []);
      setTotal(data.total || 0);
      setSummary(data.summary || {});
    } catch (err) {
      message.error(err.response?.data?.message || "Could not run the volume analysis.");
      setRows([]);
      setTotal(0);
      setSummary({});
    } finally {
      setLoading(false);
    }
  }, [filters, sort, page, pageSize]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const setFilter = (key, value) => {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: value || undefined }));
  };

  const overCount = summary.overcapacity?.count || 0;
  const overVolume = summary.overcapacity?.overcapacityM3 || 0;

  const columns = [
    {
      title: "Submission",
      dataIndex: "idNo",
      key: "idNo",
      width: 160,
      render: (v, r) => (
        <Space direction="vertical" size={0}>
          <Button type="link" size="small" style={{ padding: 0, height: "auto", fontSize: 12 }} onClick={() => onInspect(r.submissionRef)}>
            {v || "—"}
          </Button>
          <Text type="secondary" style={{ fontSize: 10 }}>
            {r.dateOfDisposal ? dayjs(r.dateOfDisposal).format("YYYY-MM-DD") : "—"}
          </Text>
        </Space>
      ),
    },
    {
      title: "LGU / PVT",
      dataIndex: "lguCompanyName",
      key: "lguCompanyName",
      width: 170,
      ellipsis: true,
      render: (v, r) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>{v || "—"}</Text>
          <Tag color={r.companyType === "LGU" ? "blue" : "geekblue"} style={{ fontSize: 10 }}>
            {r.companyType || "—"}
          </Tag>
        </Space>
      ),
    },
    { title: "SLF", dataIndex: "slfLabel", key: "slfLabel", width: 160, ellipsis: true },
    {
      title: "Cell",
      dataIndex: "cellName",
      key: "cellName",
      width: 150,
      render: (v, r) => {
        const typeConfig = getCellTypeConfig(r.cellType);
        return (
          <Space direction="vertical" size={2}>
            <Text strong style={{ fontSize: 12 }}>{v || (r.cellIndex == null ? "Unassigned" : `Cell ${r.cellIndex + 1}`)}</Text>
            <Space size={4} wrap>
              {r.cellType && <Tag color={typeConfig.tag} style={{ fontSize: 10, marginInlineEnd: 0 }}>{r.cellType}</Tag>}
              {r.cellStatus && <Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>{r.cellStatus}</Tag>}
            </Space>
          </Space>
        );
      },
    },
    {
      title: "Submitted (m³)",
      dataIndex: "submittedVolumeM3",
      key: "submittedVolumeM3",
      width: 120,
      align: "right",
      sorter: true,
      render: (v) => fmt(v),
    },
    {
      title: "Capacity (m³)",
      dataIndex: "capacityM3",
      key: "capacityM3",
      width: 120,
      align: "right",
      render: (v) => fmt(v),
    },
    {
      title: "Utilization",
      dataIndex: "utilizationPercentage",
      key: "utilizationPercentage",
      width: 130,
      align: "right",
      sorter: true,
      render: (v) =>
        v == null ? (
          <Text type="secondary">No capacity data</Text>
        ) : (
          <Text strong style={{ color: getCapacityStatus(v).color }}>
            {fmt(v)}%
          </Text>
        ),
    },
    {
      title: "Overcapacity (m³)",
      dataIndex: "overcapacityAmountM3",
      key: "overcapacityAmountM3",
      width: 140,
      align: "right",
      sorter: true,
      render: (v) =>
        v == null ? <Text type="secondary">—</Text> : v > 0 ? <Text strong type="danger">+{fmt(v)}</Text> : fmt(0),
    },
    {
      title: "Analysis",
      dataIndex: "analysisStatus",
      key: "analysisStatus",
      width: 130,
      render: (v) => {
        const status = CAPACITY_STATUS[v] || CAPACITY_STATUS.unknown;
        return <Tag color={status.tag}>{status.label}</Tag>;
      },
    },
  ];

  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Analysis only — it never modifies submissions."
        description="Utilization is the cell's recorded used capacity over its capacity (the same figures the Cell Infra Overview gauges use), so values above 100% mean the cell is over its declared capacity. Correct a record from the Records tab."
      />

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Analysed rows" value={total} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="Overcapacity rows"
              value={overCount}
              valueStyle={{ color: overCount ? CAPACITY_STATUS.overcapacity.color : undefined }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="Excess volume (m³)"
              value={parseFloat(Number(overVolume).toFixed(2))}
              valueStyle={{ color: overVolume ? CAPACITY_STATUS.overcapacity.color : undefined }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Near full / full" value={(summary.nearFull?.count || 0) + (summary.full?.count || 0)} />
          </Card>
        </Col>
      </Row>

      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          allowClear
          placeholder="Analysis status"
          style={{ width: 170 }}
          value={filters.analysisStatus}
          onChange={(v) => setFilter("analysisStatus", v)}
          options={CAPACITY_STATUS_OPTIONS}
        />
        <Select
          allowClear
          placeholder="Cell type"
          style={{ width: 190 }}
          value={filters.cellType}
          onChange={(v) => setFilter("cellType", v)}
          options={[
            { label: "Residual", value: "Residual" },
            { label: "Hazardous", value: "Hazard" },
          ]}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="SLF"
          style={{ width: 200 }}
          value={filters.slfGenerator}
          onChange={(v) => setFilter("slfGenerator", v)}
          options={(options.facilities || []).map((f) => ({ label: f.name, value: f._id }))}
        />
        <Select
          allowClear
          placeholder="LGU / PVT"
          style={{ width: 120 }}
          value={filters.companyType}
          onChange={(v) => setFilter("companyType", v)}
          options={COMPANY_TYPES}
        />
        <Select
          allowClear
          placeholder="Year"
          style={{ width: 110 }}
          value={filters.year}
          onChange={(v) => setFilter("year", v)}
          options={(options.years || []).map((y) => ({ label: String(y), value: y }))}
        />
        <Button icon={<ReloadOutlined />} loading={loading} onClick={fetchRows}>
          Re-run
        </Button>
      </Space>

      <Table
        size="small"
        rowKey={(r) => `${r.submissionRef}-${r.cellIndex}`}
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1280 }}
        onChange={(_p, _f, sorter) => {
          if (sorter?.columnKey) {
            setSort({ sortBy: sorter.columnKey, sortDir: sorter.order === "ascend" ? "asc" : "desc" });
          }
        }}
        rowClassName={(r) => (r.analysisStatus === "overcapacity" ? "raw-row-over" : "")}
        pagination={withSizeChanger({
          current: page,
          pageSize,
          total,
          size: "small",
          showTotal: (t) => `${t.toLocaleString()} row${t === 1 ? "" : "s"}`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        })}
      />
    </>
  );
}

/* ══════════════════ Shell ══════════════════ */

export default function SubmissionRawData({ isDark }) {
  const [options, setOptions] = useState({ facilities: [], years: [], statuses: [] });
  const [inspectId, setInspectId] = useState(null);

  useEffect(() => {
    api
      .get("/raw-submissions/filter-options")
      .then(({ data }) => setOptions(data || {}))
      .catch(() => {});
  }, []);

  const items = useMemo(
    () => [
      {
        key: "records",
        label: <span><DatabaseOutlined /> Records</span>,
        children: <RecordsPane options={options} />,
      },
      {
        key: "volume",
        label: <span><BarChartOutlined /> Volume Analysis</span>,
        children: <VolumeAnalysisPane options={options} onInspect={setInspectId} />,
      },
    ],
    [options],
  );

  return (
    <Card
      style={{ borderRadius: 10 }}
      styles={{ body: { paddingTop: 8 } }}
      title={
        <Space>
          <DatabaseOutlined style={{ color: "#722ed1" }} />
          <Text strong>Submission RAW Data</Text>
          <Tag color="purple">Developer</Tag>
        </Space>
      }
    >
      <style>{`
        .raw-row-deleted td { opacity: 0.55; }
        .raw-row-over td { background: ${isDark ? "rgba(255,77,79,0.12)" : "#fff1f0"} !important; }
      `}</style>
      <Tabs size="small" items={items} />

      {/* Drill-down from an analysis row into its source submission. */}
      <Modal
        open={!!inspectId}
        onCancel={() => setInspectId(null)}
        footer={<Button onClick={() => setInspectId(null)}>Close</Button>}
        width={860}
        title={<Space><DatabaseOutlined /> Source submission</Space>}
      >
        {inspectId && <RawInspector id={inspectId} />}
      </Modal>
    </Card>
  );
}
