import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Tag,
  Divider,
  Row,
  Col,
  Typography,
  DatePicker,
  Tooltip,
  Tabs,
  Collapse,
  Statistic,
  Badge,
  Popconfirm,
  Switch,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  DownloadOutlined,
  SearchOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  ReloadOutlined,
  TeamOutlined,
  CalendarOutlined,
  BarChartOutlined,
  FilterOutlined,
  ClearOutlined,
  SafetyCertificateOutlined,
  BankOutlined,
  MinusCircleOutlined,
  LinkOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  AlertOutlined,
  UserOutlined,
  SolutionOutlined,
  UndoOutlined,
  BellOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import secureStorage from "../../utils/secureStorage";
import { useDataRef } from "../../utils/dataRef";
import dayjs from "dayjs";
import {
  PieChart,
  Pie,
  Cell as RCell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const { Title, Text } = Typography;
const ACCENT = "#2f54eb";
const CHART_COLORS = ["#2f54eb", "#52c41a", "#faad14", "#ff4d4f", "#13c2c2", "#722ed1", "#eb2f96"];

const CACHE_KEY = "slf-facility-cache";
const CACHE_TTL = 5 * 60 * 1000;

function buildFilters(records, key) {
  const vals = [...new Set(records.map((r) => r[key]).filter(Boolean))].sort();
  return vals.map((v) => ({ text: v, value: v }));
}

function networkDays(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const s = dayjs(startDate).startOf("day");
  const e = dayjs(endDate).startOf("day");
  if (!s.isValid() || !e.isValid()) return null;
  let count = 0,
    cur = s;
  const dir = e.isAfter(s) ? 1 : -1;
  while (dir > 0 ? !cur.isAfter(e) : !cur.isBefore(e)) {
    const dow = cur.day();
    if (dow !== 0 && dow !== 6) count++;
    cur = cur.add(dir, "day");
  }
  return Math.max(1, count > 1 ? count - 1 : count);
}

function computeFields(rec) {
  return {
    totalDaysReportPrepared: networkDays(
      rec.dateOfMonitoring,
      rec.dateReportPrepared,
    ),
    totalDaysReviewedStaff: networkDays(
      rec.dateReportPrepared,
      rec.dateReportReviewedStaff,
    ),
    totalDaysReviewedFocal: networkDays(
      rec.dateReportReviewedStaff || rec.dateReportPrepared,
      rec.dateReportReviewedFocal,
    ),
    totalDaysApproved: networkDays(
      rec.dateReportReviewedFocal,
      rec.dateReportApproved,
    ),
  };
}

function getStatusTag(v) {
  if (!v) return <Tag color="default">—</Tag>;
  if (/operational/i.test(v) && !/non/i.test(v))
    return (
      <Tag color="green" bordered={false}>
        <CheckCircleOutlined /> Operational
      </Tag>
    );
  if (/non/i.test(v))
    return (
      <Tag color="red" bordered={false}>
        <CloseCircleOutlined /> Non-Operational
      </Tag>
    );
  return <Tag bordered={false}>{v}</Tag>;
}

// ── SLF Waste Baseline Info Sub-Tab ──
function WasteBaselineInfo() {
  const [baselines, setBaselines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedGen, setExpandedGen] = useState(null);

  useEffect(() => {
    setLoading(true);
    api
      .get("/data-slf/baselines")
      .then(({ data }) => setBaselines(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const columns = [
    {
      title: "SLF Name",
      dataIndex: "slfName",
      key: "slfName",
      render: (t) => <Text strong>{t}</Text>,
    },
    {
      title: "Status",
      dataIndex: "isActive",
      key: "isActive",
      width: 100,
      render: (v) =>
        v ? <Tag color="green">Active</Tag> : <Tag color="red">Inactive</Tag>,
    },
    {
      title: "Total Volume Accepted",
      key: "totalVolumeAccepted",
      render: (_, r) =>
        r.totalVolumeAccepted != null
          ? `${r.totalVolumeAccepted.toLocaleString()} ${(r.totalVolumeAcceptedUnit || "m³").replace("m3", "m³")}`
          : "—",
    },
    {
      title: "Active Cell (Residual)",
      key: "activeCellResidual",
      render: (_, r) =>
        r.activeCellResidualVolume != null
          ? `${r.activeCellResidualVolume.toLocaleString()} ${(r.activeCellResidualUnit || "m³").replace("m3", "m³")}`
          : "—",
    },
    {
      title: "Active Cell (Inert)",
      key: "activeCellInert",
      render: (_, r) =>
        r.activeCellInertVolume != null
          ? `${r.activeCellInertVolume.toLocaleString()} ${(r.activeCellInertUnit || "m³").replace("m3", "m³")}`
          : "—",
    },
    {
      title: "Closed Cell (Residual)",
      key: "closedCellResidual",
      render: (_, r) =>
        r.closedCellResidualVolume != null
          ? `${r.closedCellResidualVolume.toLocaleString()} ${(r.closedCellResidualUnit || "m³").replace("m3", "m³")}`
          : "—",
    },
    {
      title: "Closed Cell (Inert)",
      key: "closedCellInert",
      render: (_, r) =>
        r.closedCellInertVolume != null
          ? `${r.closedCellInertVolume.toLocaleString()} ${(r.closedCellInertUnit || "m³").replace("m3", "m³")}`
          : "—",
    },
    {
      title: "Haulers",
      key: "haulers",
      width: 80,
      render: (_, r) => r.accreditedHaulers?.length || 0,
    },
    {
      title: "Submitted By",
      dataIndex: "submittedBy",
      key: "submittedBy",
      ellipsis: true,
      render: (v) => v || "—",
    },
    {
      title: "Last Updated",
      dataIndex: "lastUpdated",
      key: "lastUpdated",
      width: 140,
      render: (v) => (v ? dayjs(v).format("MMM DD, YYYY") : "—"),
    },
  ];

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <Text type="secondary">
          Baseline waste volume information submitted by SLF portal users.
        </Text>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => {
            setLoading(true);
            api
              .get("/data-slf/baselines")
              .then(({ data }) => setBaselines(data))
              .catch(() => {})
              .finally(() => setLoading(false));
          }}
        >
          Refresh
        </Button>
      </div>
      <Table
        dataSource={baselines}
        columns={columns}
        rowKey="_id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 10 }}
        scroll={{ x: 1200 }}
        expandable={{
          expandedRowKeys: expandedGen ? [expandedGen] : [],
          onExpand: (expanded, record) =>
            setExpandedGen(expanded ? record._id : null),
          expandedRowRender: (record) =>
            record.accreditedHaulers?.length > 0 ? (
              <Table
                dataSource={record.accreditedHaulers}
                rowKey={(_, i) => i}
                size="small"
                pagination={false}
                columns={[
                  {
                    title: "Hauler Name",
                    dataIndex: "haulerName",
                    key: "haulerName",
                  },
                  {
                    title: "Number of Trucks",
                    dataIndex: "numberOfTrucks",
                    key: "numberOfTrucks",
                    render: (v) => v ?? "—",
                  },
                  {
                    title: "Private Sector Clients",
                    dataIndex: "privateSectorClients",
                    key: "privateSectorClients",
                    render: (v) => v || "—",
                  },
                ]}
              />
            ) : (
              <Text type="secondary">No accredited haulers</Text>
            ),
          rowExpandable: (record) => record.accreditedHaulers?.length > 0,
        }}
      />
    </>
  );
}

// ── Portal Generators Sub-Tab ──
function PortalGenerators({
  generators,
  loadingGen,
  fetchGenerators,
  slfRecords,
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [portalStats, setPortalStats] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loadingSub, setLoadingSub] = useState(false);
  const [form] = Form.useForm();
  const unitOptions = [
    { label: "Tons", value: "tons" },
    { label: <span>m<sup>3</sup></span>, value: "m³" },
  ];

  const fetchSubmissions = useCallback(() => {
    setLoadingSub(true);
    api
      .get("/data-slf")
      .then(({ data }) => setSubmissions(data))
      .catch(() => {})
      .finally(() => setLoadingSub(false));
  }, []);

  useEffect(() => {
    api
      .get("/data-slf/generator-summary")
      .then(({ data }) => setPortalStats(data))
      .catch(() => {});
    fetchSubmissions();
  }, [fetchSubmissions]);

  // Real-time polling every 8 seconds
  useEffect(() => {
    const interval = setInterval(fetchSubmissions, 8000);
    return () => clearInterval(interval);
  }, [fetchSubmissions]);

  const statsMap = useMemo(() => {
    const m = {};
    portalStats.forEach((s) => (m[s._id] = s));
    return m;
  }, [portalStats]);

  const overallStats = useMemo(() => {
    return portalStats.reduce(
      (acc, s) => ({
        totalEntries: acc.totalEntries + s.totalEntries,
        pendingCount: acc.pendingCount + s.pendingCount,
        acknowledgedCount: acc.acknowledgedCount + s.acknowledgedCount,
        totalVolume: acc.totalVolume + s.totalVolume,
        totalTrucks: acc.totalTrucks + s.totalTrucks,
      }),
      {
        totalEntries: 0,
        pendingCount: 0,
        acknowledgedCount: 0,
        totalVolume: 0,
        totalTrucks: 0,
      },
    );
  }, [portalStats]);

  const openAdd = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      existingBaselineUnit: "tons",
      totalVolumeSinceOperationUnit: "tons",
      totalVolumeActiveCellsUnit: "tons",
      totalVolumeClosedCellsUnit: "tons",
      isActive: true,
      accreditedHaulers: [],
    });
    setModalOpen(true);
  };
  const openEdit = (r) => {
    setEditing(r);
    form.setFieldsValue({ ...r, accreditedHaulers: r.accreditedHaulers || [] });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        await api.put(`/slf-generators/${editing._id}`, values);
        Swal.fire("Updated", "Generator updated", "success");
      } else {
        await api.post("/slf-generators", values);
        Swal.fire("Created", "Generator added", "success");
      }
      setModalOpen(false);
      fetchGenerators();
    } catch (err) {
      if (err.response)
        Swal.fire(
          "Error",
          err.response.data?.message || "Save failed",
          "error",
        );
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/slf-generators/${id}`);
      Swal.fire("Deleted", "Generator removed", "success");
      fetchGenerators();
    } catch {
      Swal.fire("Error", "Delete failed", "error");
    }
  };

  const linkedFacilities = useMemo(() => {
    const map = {};
    slfRecords.forEach((r) => {
      if (r.slfGenerator) {
        const gid =
          typeof r.slfGenerator === "object"
            ? r.slfGenerator._id
            : r.slfGenerator;
        map[gid] = (map[gid] || 0) + 1;
      }
    });
    return map;
  }, [slfRecords]);

  const genColumns = [
    {
      title: "SLF Name",
      dataIndex: "slfName",
      render: (t) => <Text strong>{t}</Text>,
    },
    {
      title: "Baseline Volume",
      render: (_, r) =>
        `${(r.existingBaselineVolume ?? 0).toLocaleString()} ${(r.existingBaselineUnit || "tons").replace("m3", "m³")}`,
    },
    {
      title: "Total Since Operation",
      render: (_, r) =>
        `${(r.totalVolumeSinceOperation ?? 0).toLocaleString()} ${(r.totalVolumeSinceOperationUnit || "tons").replace("m3", "m³")}`,
    },
    { title: "Haulers", render: (_, r) => r.accreditedHaulers?.length || 0 },
    {
      title: "Linked Facilities",
      render: (_, r) => linkedFacilities[r._id] || 0,
    },
    {
      title: "Portal Entries",
      render: (_, r) => {
        const cnt = statsMap[r._id]?.totalEntries || 0;
        return cnt > 0 ? (
          <Tag color="blue">{cnt}</Tag>
        ) : (
          <Text type="secondary">0</Text>
        );
      },
    },
    {
      title: "Pending",
      render: (_, r) => {
        const cnt = statsMap[r._id]?.pendingCount || 0;
        return cnt > 0 ? (
          <Tag color="orange">{cnt}</Tag>
        ) : (
          <Text type="secondary">0</Text>
        );
      },
    },
    {
      title: "Status",
      dataIndex: "isActive",
      render: (v) =>
        v ? <Tag color="green">Active</Tag> : <Tag color="red">Inactive</Tag>,
    },
    {
      title: "Actions",
      width: 120,
      render: (_, r) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => openEdit(r)}
          />
          <Popconfirm title="Delete?" onConfirm={() => handleDelete(r._id)}>
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const VolumeRow = ({ label, nameVal, nameUnit }) => (
    <Row gutter={8}>
      <Col xs={16}>
        <Form.Item label={label} name={nameVal}>
          <InputNumber min={0} style={{ width: "100%" }} />
        </Form.Item>
      </Col>
      <Col xs={8}>
        <Form.Item label="Unit" name={nameUnit}>
          <Select options={unitOptions} />
        </Form.Item>
      </Col>
    </Row>
  );

  return (
    <>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderRadius: 10 }}>
            <Statistic
              title="Portal Submissions"
              value={overallStats.totalEntries}
              prefix={<FileTextOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderRadius: 10 }}>
            <Statistic
              title="Total Waste Volume"
              value={overallStats.totalVolume}
              suffix="tons"
              prefix={<DatabaseOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderRadius: 10 }}>
            <Statistic
              title="Pending Reviews"
              value={overallStats.pendingCount}
              valueStyle={{ color: "#faad14" }}
              prefix={<AlertOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderRadius: 10 }}>
            <Statistic
              title="Acknowledged"
              value={overallStats.acknowledgedCount}
              valueStyle={{ color: "#52c41a" }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <Text type="secondary">
          Manage portal SLF generators that waste generators submit disposal
          data to.
        </Text>
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={openAdd}
          style={{ background: ACCENT, borderColor: ACCENT }}
        >
          Add Generator
        </Button>
      </div>
      <Table
        dataSource={generators}
        columns={genColumns}
        rowKey="_id"
        loading={loadingGen}
        size="small"
        pagination={{ pageSize: 10 }}
        scroll={{ x: 700 }}
      />

      {/* Portal Submissions Data Table */}
      <Divider orientation="left" plain>
        <FileTextOutlined style={{ color: ACCENT }} /> Portal Submitted Data
        {submissions.filter((s) => s.revertRequested).length > 0 && (
          <Badge
            count={submissions.filter((s) => s.revertRequested).length}
            style={{ marginLeft: 8, backgroundColor: "#fa8c16" }}
            title="Revert requests pending"
          />
        )}
      </Divider>
      <Table
        dataSource={submissions}
        rowKey="_id"
        loading={loadingSub}
        size="small"
        pagination={{ pageSize: 15, showSizeChanger: true, showTotal: (t) => `${t} entries` }}
        scroll={{ x: 1100 }}
        columns={[
          {
            title: "ID No",
            dataIndex: "idNo",
            key: "idNo",
            width: 160,
            render: (t) => <Text strong style={{ fontSize: 12 }}>{t}</Text>,
          },
          {
            title: "SLF Name",
            key: "slfName",
            width: 160,
            render: (_, r) =>
              r.slfGenerator?.slfName || <Text type="secondary">—</Text>,
            filters: generators.map((g) => ({ text: g.slfName, value: g._id })),
            onFilter: (val, r) => {
              const gid = r.slfGenerator?._id || r.slfGenerator;
              return gid === val;
            },
          },
          {
            title: "Company",
            dataIndex: "lguCompanyName",
            key: "lguCompanyName",
            ellipsis: true,
          },
          {
            title: "Type",
            dataIndex: "companyType",
            key: "companyType",
            width: 80,
            render: (v) =>
              v === "LGU" ? (
                <Tag color="blue">LGU</Tag>
              ) : v === "Private" ? (
                <Tag color="purple">Private</Tag>
              ) : (
                <Tag>{v || "—"}</Tag>
              ),
            filters: [
              { text: "LGU", value: "LGU" },
              { text: "Private", value: "Private" },
            ],
            onFilter: (val, r) => r.companyType === val,
          },
          {
            title: "Date of Disposal",
            dataIndex: "dateOfDisposal",
            key: "dateOfDisposal",
            width: 120,
            render: (v) => (v ? dayjs(v).format("MMM DD, YYYY") : "—"),
            sorter: (a, b) =>
              new Date(a.dateOfDisposal || 0) - new Date(b.dateOfDisposal || 0),
          },
          {
            title: "Trucks",
            key: "trucks",
            width: 70,
            render: (_, r) => r.trucks?.length || 0,
          },
          {
            title: "Total Volume",
            key: "volume",
            width: 110,
            render: (_, r) => {
              const vol = (r.trucks || []).reduce(
                (s, t) => s + (t.actualVolume || 0),
                0,
              );
              return vol > 0 ? `${vol.toLocaleString()} tons` : "—";
            },
            sorter: (a, b) => {
              const va = (a.trucks || []).reduce((s, t) => s + (t.actualVolume || 0), 0);
              const vb = (b.trucks || []).reduce((s, t) => s + (t.actualVolume || 0), 0);
              return va - vb;
            },
          },
          {
            title: "Status",
            dataIndex: "status",
            key: "status",
            width: 110,
            render: (v) => {
              const color =
                v === "acknowledged"
                  ? "green"
                  : v === "rejected"
                    ? "red"
                    : "orange";
              return <Tag color={color}>{v}</Tag>;
            },
            filters: [
              { text: "Pending", value: "pending" },
              { text: "Acknowledged", value: "acknowledged" },
              { text: "Rejected", value: "rejected" },
            ],
            onFilter: (val, r) => r.status === val,
          },
          {
            title: "Submitted",
            dataIndex: "createdAt",
            key: "createdAt",
            width: 120,
            render: (v) => (v ? dayjs(v).format("MMM DD, YYYY") : "—"),
            sorter: (a, b) =>
              new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
            defaultSortOrder: "descend",
          },
          {
            title: "Actions",
            key: "actions",
            width: 100,
            render: (_, r) => (
              <Space size="small">
                {r.revertRequested && (
                  <Tooltip title={`Revert requested: ${r.revertReason || "No reason"}`}>
                    <Popconfirm
                      title="Approve Revert?"
                      description="This will set the submission back to Pending so the portal user can edit it."
                      onConfirm={async () => {
                        try {
                          await api.patch(`/data-slf/${r._id}/approve-revert`);
                          fetchSubmissions();
                          Swal.fire({ icon: "success", title: "Reverted", text: "Submission reverted to Pending.", confirmButtonColor: ACCENT, timer: 2000 });
                        } catch (err) {
                          Swal.fire({ icon: "error", title: "Error", text: err.response?.data?.message || "Failed to revert" });
                        }
                      }}
                      okText="Revert"
                      okButtonProps={{ style: { background: "#fa8c16", borderColor: "#fa8c16" } }}
                    >
                      <Button
                        type="text"
                        size="small"
                        icon={<Badge dot><UndoOutlined style={{ color: "#fa8c16" }} /></Badge>}
                      />
                    </Popconfirm>
                  </Tooltip>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? "Edit Generator" : "Add Generator"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        width={720}
        okText="Save"
        okButtonProps={{ style: { background: ACCENT, borderColor: ACCENT } }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" size="small">
          <Form.Item
            label="SLF Name"
            name="slfName"
            rules={[{ required: true }]}
          >
            <Input placeholder="SLF name" />
          </Form.Item>
          <Form.Item label="Active" name="isActive" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Divider orientation="left" plain>
            Volume / Baseline Info
          </Divider>
          <VolumeRow
            label="Existing Baseline Volume"
            nameVal="existingBaselineVolume"
            nameUnit="existingBaselineUnit"
          />
          <VolumeRow
            label="Total Volume Since Operation"
            nameVal="totalVolumeSinceOperation"
            nameUnit="totalVolumeSinceOperationUnit"
          />
          <VolumeRow
            label="Active Cells Volume"
            nameVal="totalVolumeActiveCells"
            nameUnit="totalVolumeActiveCellsUnit"
          />
          <VolumeRow
            label="Closed Cells Volume"
            nameVal="totalVolumeClosedCells"
            nameUnit="totalVolumeClosedCellsUnit"
          />
          <Divider orientation="left" plain>
            Accredited Haulers
          </Divider>
          <Form.List name="accreditedHaulers">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...rest }) => (
                  <Card
                    key={key}
                    size="small"
                    style={{ marginBottom: 8 }}
                    extra={
                      <MinusCircleOutlined
                        style={{ color: "red" }}
                        onClick={() => remove(name)}
                      />
                    }
                  >
                    <Row gutter={12}>
                      <Col span={10}>
                        <Form.Item
                          {...rest}
                          name={[name, "haulerName"]}
                          label="Name"
                          rules={[{ required: true }]}
                        >
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item
                          {...rest}
                          name={[name, "numberOfTrucks"]}
                          label="Trucks"
                        >
                          <InputNumber min={0} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          {...rest}
                          name={[name, "privateSectorClients"]}
                          label="Clients"
                        >
                          <Input />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>
                ))}
                <Button
                  type="dashed"
                  onClick={() => add()}
                  block
                  icon={<PlusOutlined />}
                >
                  Add Hauler
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </>
  );
}

// ── Main Component ──
export default function SLFMonitoring() {
  const { getValues } = useDataRef();
  const provinceOptions = getValues("province").map((p) => ({ label: p, value: p }));
  const monthOptions = getValues("target-month").map((m) => ({ label: m.replace(/^\d+\./, ""), value: m }));
  const mbaOptions = getValues("manila-bay-area").map((v) => ({ label: v, value: v }));
  const slfStatusOptions = getValues("slf-status").map((v) => ({ label: v, value: v }));
  const ownershipOptions = getValues("ownership").map((v) => ({ label: v, value: v }));
  const wasteTypeOptions = getValues("waste-type").map((v) => ({ label: v, value: v }));
  const enmoOptions = getValues("enmo").map((v) => ({ label: v, value: v }));
  const eswmStaffOptions = getValues("eswm-staff").map((v) => ({ label: v, value: v }));
  const focalOptions = getValues("eswm-focal").map((v) => ({ label: v, value: v }));

  const [records, setRecords] = useState([]);
  const [generators, setGenerators] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingGen, setLoadingGen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailModal, setDetailModal] = useState(null);
  const [baselineData, setBaselineData] = useState(null);
  const [loadingBaseline, setLoadingBaseline] = useState(false);
  const [editing, setEditing] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [filterProvince, setFilterProvince] = useState(null);
  const [filterStatus, setFilterStatus] = useState(null);
  const [filterCategory, setFilterCategory] = useState(null);
  const [filterMonth, setFilterMonth] = useState(null);
  const [form] = Form.useForm();

  const fetchRecords = useCallback(async (skipCache = false) => {
    setLoading(true);
    try {
      if (!skipCache) {
        const cached = secureStorage.getJSON(CACHE_KEY);
        if (cached && Date.now() - cached.ts < CACHE_TTL) {
          setRecords(cached.data.map((r) => ({ ...r, ...computeFields(r) })));
          setLoading(false);
          return;
        }
      }
      const { data } = await api.get("/slf-facilities");
      const enriched = data.map((r) => ({ ...r, ...computeFields(r) }));
      setRecords(enriched);
      secureStorage.setJSON(CACHE_KEY, { data, ts: Date.now() });
    } catch {
      Swal.fire("Error", "Failed to load records", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchGenerators = useCallback(async () => {
    setLoadingGen(true);
    try {
      const { data } = await api.get("/slf-generators");
      setGenerators(data);
    } catch {
      /* silent */
    } finally {
      setLoadingGen(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
    fetchGenerators();
  }, [fetchRecords, fetchGenerators]);

  // Fetch baseline data when detail modal opens for a facility with linked generator
  useEffect(() => {
    if (!detailModal) {
      setBaselineData(null);
      return;
    }
    const gen = detailModal.slfGenerator;
    const slfName =
      gen && typeof gen === "object" ? gen.slfName : null;
    if (!slfName) {
      setBaselineData(null);
      return;
    }
    setLoadingBaseline(true);
    api
      .get(`/data-slf/baseline/${encodeURIComponent(slfName)}`)
      .then(({ data }) => setBaselineData(data))
      .catch(() => setBaselineData(null))
      .finally(() => setLoadingBaseline(false));
  }, [detailModal]);

  const generatorOptions = useMemo(
    () => generators.map((g) => ({ label: g.slfName, value: g._id })),
    [generators],
  );

  const openAdd = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };
  const openEdit = (record) => {
    setEditing(record);
    const genId = record.slfGenerator
      ? typeof record.slfGenerator === "object"
        ? record.slfGenerator._id
        : record.slfGenerator
      : null;
    form.setFieldsValue({
      ...record,
      slfGenerator: genId,
      dateOfMonitoring: record.dateOfMonitoring
        ? dayjs(record.dateOfMonitoring)
        : null,
      dateReportPrepared: record.dateReportPrepared
        ? dayjs(record.dateReportPrepared)
        : null,
      dateReportReviewedStaff: record.dateReportReviewedStaff
        ? dayjs(record.dateReportReviewedStaff)
        : null,
      dateReportReviewedFocal: record.dateReportReviewedFocal
        ? dayjs(record.dateReportReviewedFocal)
        : null,
      dateReportApproved: record.dateReportApproved
        ? dayjs(record.dateReportApproved)
        : null,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        ...values,
        dateOfMonitoring: values.dateOfMonitoring?.toISOString(),
        dateReportPrepared: values.dateReportPrepared?.toISOString(),
        dateReportReviewedStaff: values.dateReportReviewedStaff?.toISOString(),
        dateReportReviewedFocal: values.dateReportReviewedFocal?.toISOString(),
        dateReportApproved: values.dateReportApproved?.toISOString(),
      };
      Object.assign(payload, computeFields(payload));
      if (editing) {
        const { data } = await api.put(
          `/slf-facilities/${editing._id}`,
          payload,
        );
        setRecords((prev) =>
          prev.map((r) =>
            r._id === editing._id ? { ...data, ...computeFields(data) } : r,
          ),
        );
        secureStorage.remove(CACHE_KEY);
        secureStorage.invalidateDashboard();
        Swal.fire("Updated", "Record updated successfully", "success");
      } else {
        await api.post("/slf-facilities", payload);
        secureStorage.remove(CACHE_KEY);
        secureStorage.invalidateDashboard();
        Swal.fire("Created", "Record added successfully", "success");
        fetchRecords();
      }
    } catch (err) {
      if (err.response)
        Swal.fire(
          "Error",
          err.response.data?.message || "Save failed",
          "error",
        );
    }
    setModalOpen(false);
  };

  const filtered = useMemo(() => {
    let data = records;
    if (searchText) {
      const q = searchText.toLowerCase();
      data = data.filter((r) =>
        [
          r.province,
          r.lgu,
          r.barangay,
          r.enmo,
          r.focalPerson,
          r.ownership,
        ].some((v) => v && v.toLowerCase().includes(q)),
      );
    }
    if (filterProvince)
      data = data.filter((r) => r.province === filterProvince);
    if (filterStatus) data = data.filter((r) => r.statusOfSLF === filterStatus);
    if (filterCategory)
      data = data.filter((r) => r.category === filterCategory);
    if (filterMonth) data = data.filter((r) => r.targetMonth === filterMonth);
    return data;
  }, [
    records,
    searchText,
    filterProvince,
    filterStatus,
    filterCategory,
    filterMonth,
  ]);

  const hasFilters =
    searchText ||
    filterProvince ||
    filterStatus ||
    filterCategory ||
    filterMonth;
  const clearFilters = () => {
    setSearchText("");
    setFilterProvince(null);
    setFilterStatus(null);
    setFilterCategory(null);
    setFilterMonth(null);
  };

  // Summary tiles
  const totalRecords = filtered.length;
  const opCount = filtered.filter(
    (r) => /operational/i.test(r.statusOfSLF) && !/non/i.test(r.statusOfSLF),
  ).length;
  const nonOpCount = filtered.filter((r) => /non/i.test(r.statusOfSLF)).length;
  const totalCapacity = filtered.reduce(
    (s, r) => s + (r.volumeCapacity || 0),
    0,
  );
  const totalLGUs = filtered.reduce((s, r) => s + (r.noOfLGUServed || 0), 0);
  const totalCells = filtered.reduce((s, r) => s + (r.numberOfCell || 0), 0);
  const totalLeachate = filtered.reduce(
    (s, r) => s + (r.noOfLeachatePond || 0),
    0,
  );
  const totalGasVents = filtered.reduce(
    (s, r) => s + (r.numberOfGasVents || 0),
    0,
  );
  const totalWaste = filtered.reduce(
    (s, r) => s + (r.actualResidualWasteReceived || 0),
    0,
  );
  const privateSectorCount = filtered.filter(
    (r) => /private/i.test(r.ownership),
  ).length;

  // Denominators — counts of records that have a value for each metric
  const cellsWithData = filtered.filter((r) => r.numberOfCell > 0).length;
  const lgusWithData = filtered.filter((r) => r.noOfLGUServed > 0).length;
  const capacityWithData = filtered.filter((r) => r.volumeCapacity > 0).length;
  const wasteWithData = filtered.filter((r) => r.actualResidualWasteReceived > 0).length;
  const leachateWithData = filtered.filter((r) => r.noOfLeachatePond > 0).length;
  const gasVentsWithData = filtered.filter((r) => r.numberOfGasVents > 0).length;
  const privateWithData = filtered.filter((r) => /private/i.test(r.ownership)).length;

  // Category descriptions
  const CATEGORY_DESC = {
    "Cat 1": "< 15 TPD",
    "Cat 2": "15–75 TPD",
    "Cat 3": "75–150 TPD",
    "Cat 4": "> 150 TPD",
  };

  const columns = [
    {
      title: "#",
      key: "idx",
      width: 50,
      fixed: "left",
      render: (_, __, i) => i + 1,
    },
    {
      title: (
        <>
          <EnvironmentOutlined style={{ color: ACCENT }} /> LGU
        </>
      ),
      key: "lgu",
      width: 150,
      fixed: "left",
      filters: buildFilters(records, "province"),
      onFilter: (v, r) => r.province === v,
      sorter: (a, b) => (a.lgu || "").localeCompare(b.lgu || ""),
      render: (_, r) => (
        <Tooltip
          title={`${r.province} — ${r.lgu}${r.barangay ? ` (${r.barangay})` : ""}`}
        >
          <div style={{ lineHeight: 1.3 }}>
            <Text strong style={{ fontSize: 12 }}>
              {r.lgu}
            </Text>
            <br />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {r.province}
              {r.barangay ? ` · ${r.barangay}` : ""}
            </Text>
          </div>
        </Tooltip>
      ),
    },
    {
      title: "MBA",
      dataIndex: "manilaBayArea",
      width: 70,
      filters: buildFilters(records, "manilaBayArea"),
      onFilter: (v, r) => r.manilaBayArea === v,
    },
    {
      title: "Ownership",
      dataIndex: "ownership",
      width: 100,
      filters: buildFilters(records, "ownership"),
      onFilter: (v, r) => r.ownership === v,
    },
    {
      title: "Category",
      dataIndex: "category",
      width: 130,
      render: (v) =>
        v ? (
          <Tooltip title={CATEGORY_DESC[v] || v}>
            <Tag color="blue" bordered={false}>
              {v}{CATEGORY_DESC[v] ? ` — ${CATEGORY_DESC[v]}` : ""}
            </Tag>
          </Tooltip>
        ) : (
          "—"
        ),
      filters: buildFilters(records, "category"),
      onFilter: (v, r) => r.category === v,
    },
    {
      title: (
        <>
          <SafetyCertificateOutlined style={{ color: "#52c41a" }} /> Status
        </>
      ),
      key: "status",
      width: 140,
      filters: buildFilters(records, "statusOfSLF"),
      onFilter: (v, r) => r.statusOfSLF === v,
      sorter: (a, b) =>
        (a.yearStartedOperation || 0) - (b.yearStartedOperation || 0),
      render: (_, r) => (
        <div style={{ lineHeight: 1.3 }}>
          {getStatusTag(r.statusOfSLF)}
          {r.yearStartedOperation && (
            <div>
              <Text type="secondary" style={{ fontSize: 10 }}>
                <CalendarOutlined style={{ marginRight: 3 }} />
                Since {r.yearStartedOperation}
              </Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: "Capacity",
      dataIndex: "volumeCapacity",
      width: 100,
      sorter: (a, b) => (a.volumeCapacity || 0) - (b.volumeCapacity || 0),
      render: (v) =>
        v != null ? (
          <Text strong style={{ color: ACCENT }}>
            {Number(v).toLocaleString()}
          </Text>
        ) : (
          "—"
        ),
    },
    {
      title: "LGUs Served",
      dataIndex: "noOfLGUServed",
      width: 100,
      sorter: (a, b) => (a.noOfLGUServed || 0) - (b.noOfLGUServed || 0),
    },
    { title: "Cells", dataIndex: "numberOfCell", width: 70 },
    { title: "Leachate", dataIndex: "noOfLeachatePond", width: 80 },
    { title: "Gas Vents", dataIndex: "numberOfGasVents", width: 80 },
    {
      title: "Waste (tons)",
      dataIndex: "actualResidualWasteReceived",
      width: 110,
      sorter: (a, b) =>
        (a.actualResidualWasteReceived || 0) -
        (b.actualResidualWasteReceived || 0),
      render: (v) => (v != null ? Number(v).toLocaleString() : "—"),
    },
    { title: "Lifespan", dataIndex: "remainingLifeSpan", width: 100 },
    {
      title: "Portal Link",
      key: "portal",
      width: 100,
      render: (_, r) => {
        const g = r.slfGenerator;
        return g ? (
          <Tag color="blue" bordered={false}>
            <LinkOutlined /> {typeof g === "object" ? g.slfName : "Linked"}
          </Tag>
        ) : (
          <Tag color="default">—</Tag>
        );
      },
    },
    {
      title: (
        <>
          <CalendarOutlined style={{ color: "#13c2c2" }} /> Target Month
        </>
      ),
      dataIndex: "targetMonth",
      key: "targetMonth",
      width: 220,
      ellipsis: true,
      filters: buildFilters(records, "targetMonth"),
      onFilter: (v, r) => r.targetMonth === v,
      render: (v) =>
        v ? (
          <Tag bordered={false} color="cyan">
            {v.replace(/^\d+\./, "")}
          </Tag>
        ) : (
          "—"
        ),
    },
    {
      title: (
        <>
          <TeamOutlined style={{ color: "#722ed1" }} /> Personnel
        </>
      ),
      key: "personnel",
      width: 170,
      ellipsis: false,
      render: (_, r) => (
        <Tooltip
          title={
            <div>
              <div>
                <UserOutlined /> ENMO: {r.enmo || "—"}
              </div>
              <div>
                <UserOutlined /> Focal: {r.focalPerson || "—"}
              </div>
            </div>
          }
        >
          <div
            style={{
              lineHeight: 1.3,
              whiteSpace: "normal",
              wordBreak: "break-word",
            }}
          >
            <Text style={{ fontSize: 11 }}>
              <UserOutlined style={{ color: "#722ed1", marginRight: 4 }} />
              {r.focalPerson || "—"}
            </Text>
            <br />
            <Text type="secondary" style={{ fontSize: 10 }}>
              <SolutionOutlined style={{ marginRight: 3 }} />
              {r.enmo || "—"}
            </Text>
          </div>
        </Tooltip>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 100,
      fixed: "right",
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="View">
            <Button
              size="small"
              type="text"
              icon={<EyeOutlined />}
              onClick={() => setDetailModal(r)}
            />
          </Tooltip>
          <Tooltip title="Edit">
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              onClick={() => openEdit(r)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const handleExport = () => {
    const rows = filtered.map((r, i) => ({
      "#": i + 1,
      Province: r.province,
      LGU: r.lgu,
      Barangay: r.barangay,
      MBA: r.manilaBayArea,
      Ownership: r.ownership,
      Category: r.category,
      Status: r.statusOfSLF,
      "Year Started": r.yearStartedOperation,
      Capacity: r.volumeCapacity,
      "LGUs Served": r.noOfLGUServed,
      Cells: r.numberOfCell,
      Leachate: r.noOfLeachatePond,
      "Gas Vents": r.numberOfGasVents,
      "Waste Received": r.actualResidualWasteReceived,
      Lifespan: r.remainingLifeSpan,
      "Target Month": r.targetMonth,
      ENMO: r.enmo,
      Focal: r.focalPerson,
    }));
    exportToExcel(rows, "SLF_Facilities_Data");
  };

  return (
    <div style={{ padding: 0 }}>
      {/* Summary tiles */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {/* Row 1 */}
        <Col xs={12} sm={6} md={6} lg={6}>
          <Card size="small" hoverable style={{ borderRadius: 10, borderLeft: `4px solid ${ACCENT}`, height: "100%" }}>
            <Statistic
              title="Total SLF"
              value={totalRecords}
              prefix={<BankOutlined style={{ color: ACCENT }} />}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              <CheckCircleOutlined style={{ color: "#52c41a", marginRight: 3 }} />{opCount}/{totalRecords} Operational
            </Text>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={6} lg={6}>
          <Card size="small" hoverable style={{ borderRadius: 10, borderLeft: "4px solid #13c2c2", height: "100%" }}>
            <Statistic
              title="Total Cells"
              value={totalCells}
              prefix={<ExperimentOutlined style={{ color: "#13c2c2" }} />}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>{cellsWithData}/{totalRecords} with cells</Text>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={6} lg={6}>
          <Card size="small" hoverable style={{ borderRadius: 10, borderLeft: "4px solid #fa8c16", height: "100%" }}>
            <Statistic
              title="LGUs Served"
              value={totalLGUs}
              prefix={<TeamOutlined style={{ color: "#fa8c16" }} />}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>{lgusWithData}/{totalRecords} reporting</Text>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={6} lg={6}>
          <Card size="small" hoverable style={{ borderRadius: 10, borderLeft: "4px solid #722ed1", height: "100%" }}>
            <Statistic
              title="Private Sectors Served"
              value={privateSectorCount}
              prefix={<BankOutlined style={{ color: "#722ed1" }} />}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>{privateWithData}/{totalRecords} private-owned</Text>
          </Card>
        </Col>
        {/* Row 2 */}
        <Col xs={12} sm={6} md={6} lg={6}>
          <Card size="small" hoverable style={{ borderRadius: 10, borderLeft: "4px solid #eb2f96", height: "100%" }}>
            <Statistic
              title="Total Capacity"
              value={totalCapacity}
              prefix={<DatabaseOutlined style={{ color: "#eb2f96" }} />}
              formatter={(v) => Number(v).toLocaleString()}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>{capacityWithData}/{totalRecords} with data</Text>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={6} lg={6}>
          <Card size="small" hoverable style={{ borderRadius: 10, borderLeft: "4px solid #ff4d4f", height: "100%" }}>
            <Statistic
              title="Waste Received"
              value={totalWaste}
              suffix="tons"
              prefix={<BarChartOutlined style={{ color: "#ff4d4f" }} />}
              formatter={(v) => Number(v).toLocaleString()}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>{wasteWithData}/{totalRecords} reporting</Text>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={6} lg={6}>
          <Card size="small" hoverable style={{ borderRadius: 10, borderLeft: "4px solid #1890ff", height: "100%" }}>
            <Statistic
              title="Leachate Ponds"
              value={totalLeachate}
              prefix={<AlertOutlined style={{ color: "#1890ff" }} />}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>{leachateWithData}/{totalRecords} with ponds</Text>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={6} lg={6}>
          <Card size="small" hoverable style={{ borderRadius: 10, borderLeft: "4px solid #52c41a", height: "100%" }}>
            <Statistic
              title="Gas Vents"
              value={totalGasVents}
              prefix={<ExperimentOutlined style={{ color: "#52c41a" }} />}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>{gasVentsWithData}/{totalRecords} with vents</Text>
          </Card>
        </Col>
      </Row>

      <Tabs
        defaultActiveKey="facilities"
        items={[
          {
            key: "facilities",
            label: (
              <>
                <BankOutlined /> Sanitary Landfill Facility
              </>
            ),
            children: (
              <>
                {/* Header with Search + Export */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 16,
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <Title level={4} style={{ margin: 0 }}>
                    <BankOutlined /> Sanitary Landfill Facility
                  </Title>
                  <Space wrap>
                    <Input
                      placeholder="Search..."
                      prefix={<SearchOutlined />}
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      style={{ width: "100%", maxWidth: 200 }}
                      allowClear
                    />
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={openAdd}
                      style={{ background: ACCENT, borderColor: ACCENT }}
                    >
                      Add Record
                    </Button>
                    <Button icon={<DownloadOutlined />} onClick={handleExport}>
                      Export
                    </Button>
                    <Tooltip title="Refresh data">
                      <Button
                        icon={<ReloadOutlined />}
                        onClick={() => fetchRecords(true)}
                        loading={loading}
                      />
                    </Tooltip>
                  </Space>
                </div>

                {/* Filter Bar */}
                <Card
                  size="small"
                  style={{ borderRadius: 10, marginBottom: 12 }}
                  bodyStyle={{ padding: "10px 16px" }}
                >
                  <Row gutter={[10, 10]} align="middle">
                    <Col>
                      <FilterOutlined
                        style={{ color: ACCENT, marginRight: 6 }}
                      />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Filters:
                      </Text>
                    </Col>
                    <Col flex="auto">
                      <Space wrap size={8}>
                        <Select
                          placeholder="Province"
                          value={filterProvince}
                          onChange={setFilterProvince}
                          allowClear
                          style={{
                            width: "100%",
                            minWidth: 120,
                            maxWidth: 160,
                          }}
                          size="small"
                          options={provinceOptions}
                          suffixIcon={<EnvironmentOutlined />}
                        />
                        <Select
                          placeholder="Status"
                          value={filterStatus}
                          onChange={setFilterStatus}
                          allowClear
                          style={{
                            width: "100%",
                            minWidth: 110,
                            maxWidth: 160,
                          }}
                          size="small"
                          options={buildFilters(records, "statusOfSLF")}
                          suffixIcon={<SafetyCertificateOutlined />}
                        />
                        <Select
                          placeholder="Category"
                          value={filterCategory}
                          onChange={setFilterCategory}
                          allowClear
                          style={{
                            width: "100%",
                            minWidth: 110,
                            maxWidth: 150,
                          }}
                          size="small"
                          options={buildFilters(records, "category")}
                        />
                        <Select
                          placeholder="Target Month"
                          value={filterMonth}
                          onChange={setFilterMonth}
                          allowClear
                          style={{
                            width: "100%",
                            minWidth: 110,
                            maxWidth: 150,
                          }}
                          size="small"
                          options={monthOptions}
                          suffixIcon={<CalendarOutlined />}
                        />
                        {hasFilters && (
                          <Tooltip title="Clear all filters">
                            <Button
                              size="small"
                              type="link"
                              danger
                              icon={<ClearOutlined />}
                              onClick={clearFilters}
                            >
                              Clear
                            </Button>
                          </Tooltip>
                        )}
                      </Space>
                    </Col>
                    <Col>
                      <Tag
                        bordered={false}
                        color={hasFilters ? "blue" : "default"}
                      >
                        {filtered.length} / {records.length} records
                      </Tag>
                    </Col>
                  </Row>
                </Card>

                {/* Table */}
                <Card size="small" style={{ borderRadius: 10 }}>
                  <Table
                    dataSource={filtered}
                    columns={columns}
                    rowKey="_id"
                    loading={loading}
                    size="small"
                    scroll={{ x: 1800 }}
                    pagination={{
                      pageSize: 50,
                      showSizeChanger: true,
                      showTotal: (t) => `${t} records`,
                    }}
                  />
                </Card>
              </>
            ),
          },
          {
            key: "portal",
            label: (
              <>
                <LinkOutlined /> Waste Generators
              </>
            ),
            children: (
              <PortalGenerators
                generators={generators}
                loadingGen={loadingGen}
                fetchGenerators={fetchGenerators}
                slfRecords={records}
              />
            ),
          },
        ]}
      />

      {/* Add/Edit Modal */}
      <Modal
        title={editing ? "Edit SLF Facility" : "Add SLF Facility"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        width={960}
        okText="Save"
        okButtonProps={{ style: { background: ACCENT, borderColor: ACCENT } }}
      >
        <Form form={form} layout="vertical" size="small">
          <Collapse
            defaultActiveKey={["location","facility","permits","personnel","monitoring","portal","compliance"]}
            bordered={false}
            items={[
              {
                key: "location",
                label: <span style={{ color: "#1677ff" }}><EnvironmentOutlined /> Location</span>,
                children: (
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item
                name="province"
                label="Province"
                rules={[{ required: true }]}
              >
                <Select options={provinceOptions} placeholder="Select" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="lgu" label="LGU" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="barangay" label="Barangay">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="manilaBayArea" label="Manila Bay Area">
                <Select options={mbaOptions} allowClear placeholder="Select" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="congressionalDistrict"
                label="Congressional District"
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="ownership" label="Ownership">
                <Select options={ownershipOptions} allowClear placeholder="Select" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="latitude" label="Latitude">
                <InputNumber style={{ width: "100%" }} step={0.0001} precision={10} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="longitude" label="Longitude">
                <InputNumber style={{ width: "100%" }} step={0.0001} precision={10} />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
              {
                key: "facility",
                label: <span style={{ color: "#fa8c16" }}><BankOutlined /> Facility Details</span>,
                children: (
          <Row gutter={12}>
            <Col span={6}>
              <Form.Item name="yearStartedOperation" label="Year Started">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="category" label="Category">
                <Select options={wasteTypeOptions} allowClear placeholder="Select" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="volumeCapacity" label="Volume Capacity">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="noOfLGUServed" label="LGUs Served">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="statusOfSLF" label="Status">
                <Select options={slfStatusOptions} allowClear placeholder="Select Status" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="remainingLifeSpan" label="Remaining Lifespan">
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="numberOfCell" label="No. of Cells">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="noOfLeachatePond" label="Leachate Ponds">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="numberOfGasVents" label="Gas Vents">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="actualResidualWasteReceived"
                label="Waste Received"
              >
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="estimatedVolumeWaste" label="Est. Volume Waste">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="mrfEstablished" label="MRF Established">
                <Input />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
              {
                key: "permits",
                label: <span style={{ color: "#faad14" }}><SafetyCertificateOutlined /> Permits</span>,
                children: (
          <Row gutter={12}>
            <Col span={6}>
              <Form.Item name="eccNo" label="ECC No.">
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="dischargePermit" label="Discharge Permit">
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="permitToOperate" label="Permit to Operate">
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="hazwasteGenerationId" label="Hazwaste Gen. ID">
                <Input />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
              {
                key: "personnel",
                label: <span style={{ color: "#52c41a" }}><TeamOutlined /> Personnel</span>,
                children: (
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="targetMonth" label="Target Month">
                <Select
                  options={monthOptions}
                  placeholder="Select"
                  allowClear
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="enmo" label="ENMO">
                <Select options={enmoOptions} allowClear showSearch placeholder="Select ENMO" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="eswmStaff" label="ESWM Staff">
                <Select options={eswmStaffOptions} allowClear showSearch placeholder="Select Staff" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="focalPerson" label="Focal Person">
                <Select options={focalOptions} allowClear showSearch placeholder="Select Focal" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="iisNumber" label="IIS Number">
                <Input />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
              {
                key: "monitoring",
                label: <span style={{ color: "#13c2c2" }}><CalendarOutlined /> Monitoring Dates</span>,
                children: (
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="dateOfMonitoring" label="Monitoring">
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="dateReportPrepared" label="Report Prepared">
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="dateReportReviewedStaff"
                label="Reviewed (Staff)"
              >
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="dateReportReviewedFocal"
                label="Reviewed (Focal)"
              >
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="dateReportApproved" label="Approved">
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
              {
                key: "portal",
                label: <span style={{ color: "#597ef7" }}><LinkOutlined /> Portal Link</span>,
                children: (
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="slfGenerator" label="Link to Portal Generator">
                <Select
                  options={generatorOptions}
                  placeholder="Select generator (optional)"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
              {
                key: "compliance",
                label: <span style={{ color: "#eb2f96" }}><FileTextOutlined /> Compliance</span>,
                children: (
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="remarksAndRecommendation" label="Remarks">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="findings" label="Findings">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="adviseLetterDateIssued"
                label="Advise Letter Date"
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="complianceToAdvise" label="Compliance">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="signedDocument" label="Signed Document">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="docketNoNOV" label="Docket No. (NOV)">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="dateOfIssuanceNOV" label="NOV Issuance Date">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="dateOfTechnicalConference"
                label="Tech Conference Date"
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="commitments" label="Commitments">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="remarksCompliance" label="Compliance Remarks">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
            ]}
          />
        </Form>
      </Modal>

      {/* Detail Modal */}
      <Modal
        title={
          <Space>
            <BankOutlined /> SLF Facility Details
          </Space>
        }
        open={!!detailModal}
        onCancel={() => setDetailModal(null)}
        footer={<Button onClick={() => setDetailModal(null)}>Close</Button>}
        width={900}
      >
        {detailModal && (
          <Tabs
            defaultActiveKey="1"
            items={[
              {
                key: "1",
                label: "Location & Status",
                children: (
                  <Row gutter={[16, 8]}>
                    <Col span={12}>
                      <Text type="secondary">Province:</Text>{" "}
                      <Text strong>{detailModal.province}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">LGU:</Text>{" "}
                      <Text strong>{detailModal.lgu}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Barangay:</Text>{" "}
                      <Text strong>{detailModal.barangay || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">MBA:</Text>{" "}
                      <Text strong>{detailModal.manilaBayArea || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Ownership:</Text>{" "}
                      <Text strong>{detailModal.ownership || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">District:</Text>{" "}
                      <Text strong>
                        {detailModal.congressionalDistrict || "—"}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Status:</Text>{" "}
                      {getStatusTag(detailModal.statusOfSLF)}
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Category:</Text>{" "}
                      {detailModal.category ? (
                        <Tag color="blue">{detailModal.category}</Tag>
                      ) : (
                        "—"
                      )}
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Year Started:</Text>{" "}
                      <Text strong>
                        {detailModal.yearStartedOperation || "—"}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Capacity:</Text>{" "}
                      <Text strong>
                        {detailModal.volumeCapacity
                          ? Number(detailModal.volumeCapacity).toLocaleString()
                          : "—"}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">LGUs Served:</Text>{" "}
                      <Text strong>{detailModal.noOfLGUServed || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Remaining Lifespan:</Text>{" "}
                      <Text strong>{detailModal.remainingLifeSpan || "—"}</Text>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "2",
                label: (
                  <>
                    <BarChartOutlined /> Operations
                  </>
                ),
                children: (() => {
                  const cells = detailModal.numberOfCell || 0;
                  const leachate = detailModal.noOfLeachatePond || 0;
                  const gasVents = detailModal.numberOfGasVents || 0;
                  const wasteReceived = detailModal.actualResidualWasteReceived || 0;
                  const estVolume = detailModal.estimatedVolumeWaste || 0;
                  const capacity = detailModal.volumeCapacity || 0;
                  const infraData = [
                    { name: "Cells", value: cells },
                    { name: "Leachate Ponds", value: leachate },
                    { name: "Gas Vents", value: gasVents },
                  ].filter((d) => d.value > 0);
                  const capacityData =
                    capacity > 0
                      ? [
                          { name: "Waste Received", value: Math.min(wasteReceived, capacity) },
                          { name: "Remaining", value: Math.max(0, capacity - wasteReceived) },
                        ]
                      : wasteReceived > 0
                        ? [{ name: "Waste Received", value: wasteReceived }]
                        : [];
                  const volumeData = [
                    wasteReceived > 0 && { name: "Waste Received", value: wasteReceived },
                    estVolume > 0 && { name: "Est. Volume", value: estVolume },
                    capacity > 0 && { name: "Capacity", value: capacity },
                  ].filter(Boolean);
                  // Cell volume data from baseline
                  const cellVolumeData = baselineData
                    ? [
                        baselineData.activeCellResidualVolume > 0 && {
                          name: "Active Residual",
                          value: baselineData.activeCellResidualVolume,
                          unit: (baselineData.activeCellResidualUnit || "m³").replace("m3", "m³"),
                        },
                        baselineData.activeCellInertVolume > 0 && {
                          name: "Active Inert",
                          value: baselineData.activeCellInertVolume,
                          unit: (baselineData.activeCellInertUnit || "m³").replace("m3", "m³"),
                        },
                        baselineData.closedCellResidualVolume > 0 && {
                          name: "Closed Residual",
                          value: baselineData.closedCellResidualVolume,
                          unit: (baselineData.closedCellResidualUnit || "m³").replace("m3", "m³"),
                        },
                        baselineData.closedCellInertVolume > 0 && {
                          name: "Closed Inert",
                          value: baselineData.closedCellInertVolume,
                          unit: (baselineData.closedCellInertUnit || "m³").replace("m3", "m³"),
                        },
                      ].filter(Boolean)
                    : [];
                  const hasCharts = infraData.length > 0 || capacityData.length > 0 || cellVolumeData.length > 0;
                  return (
                    <>
                      <Row gutter={[16, 8]} style={{ marginBottom: 16 }}>
                        <Col span={8}>
                          <Text type="secondary">Cells:</Text>{" "}
                          <Text strong>{cells || "—"}</Text>
                        </Col>
                        <Col span={8}>
                          <Text type="secondary">Leachate Ponds:</Text>{" "}
                          <Text strong>{leachate || "—"}</Text>
                        </Col>
                        <Col span={8}>
                          <Text type="secondary">Gas Vents:</Text>{" "}
                          <Text strong>{gasVents || "—"}</Text>
                        </Col>
                        <Col span={12}>
                          <Text type="secondary">Waste Received:</Text>{" "}
                          <Text strong>
                            {wasteReceived ? `${Number(wasteReceived).toLocaleString()} tons` : "—"}
                          </Text>
                        </Col>
                        <Col span={12}>
                          <Text type="secondary">Est. Volume:</Text>{" "}
                          <Text strong>
                            {estVolume ? Number(estVolume).toLocaleString() : "—"}
                          </Text>
                        </Col>
                        <Col span={12}>
                          <Text type="secondary">MRF Established:</Text>{" "}
                          <Text strong>{detailModal.mrfEstablished || "—"}</Text>
                        </Col>
                        <Divider plain orientation="left">
                          Permits
                        </Divider>
                        <Col span={12}>
                          <Text type="secondary">ECC No.:</Text>{" "}
                          <Text>{detailModal.eccNo || "—"}</Text>
                        </Col>
                        <Col span={12}>
                          <Text type="secondary">Discharge Permit:</Text>{" "}
                          <Text>{detailModal.dischargePermit || "—"}</Text>
                        </Col>
                        <Col span={12}>
                          <Text type="secondary">Permit to Operate:</Text>{" "}
                          <Text>{detailModal.permitToOperate || "—"}</Text>
                        </Col>
                        <Col span={12}>
                          <Text type="secondary">Hazwaste Gen. ID:</Text>{" "}
                          <Text>{detailModal.hazwasteGenerationId || "—"}</Text>
                        </Col>
                        {detailModal.slfGenerator && (
                          <>
                            <Divider plain orientation="left">
                              Portal Link
                            </Divider>
                            <Col span={24}>
                              <Tag color="blue" icon={<LinkOutlined />}>
                                {typeof detailModal.slfGenerator === "object"
                                  ? detailModal.slfGenerator.slfName
                                  : "Linked Generator"}
                              </Tag>
                            </Col>
                          </>
                        )}
                      </Row>
                      {hasCharts && (
                        <>
                          <Divider plain orientation="left">
                            <BarChartOutlined /> Charts
                          </Divider>
                          <Row gutter={[16, 16]}>
                            {/* Infrastructure Breakdown */}
                            {infraData.length > 0 && (
                              <Col xs={24} md={12}>
                                <Card size="small" title="Infrastructure Count" style={{ borderRadius: 10 }}>
                                  <ResponsiveContainer width="100%" height={220}>
                                    <BarChart data={infraData}>
                                      <CartesianGrid strokeDasharray="3 3" />
                                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                                      <YAxis allowDecimals={false} />
                                      <RTooltip />
                                      <Bar dataKey="value" fill={ACCENT} radius={[4, 4, 0, 0]}>
                                        {infraData.map((_, i) => (
                                          <RCell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                        ))}
                                      </Bar>
                                    </BarChart>
                                  </ResponsiveContainer>
                                </Card>
                              </Col>
                            )}
                            {/* Capacity Utilization Pie */}
                            {capacityData.length > 0 && (
                              <Col xs={24} md={12}>
                                <Card size="small" title="Waste Capacity Utilization" style={{ borderRadius: 10 }}>
                                  <ResponsiveContainer width="100%" height={220}>
                                    <PieChart>
                                      <Pie
                                        data={capacityData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={50}
                                        outerRadius={80}
                                        paddingAngle={3}
                                        dataKey="value"
                                        label={({ name, value }) => `${name}: ${value.toLocaleString()}`}
                                      >
                                        {capacityData.map((_, i) => (
                                          <RCell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                        ))}
                                      </Pie>
                                      <RTooltip formatter={(v) => v.toLocaleString()} />
                                      <Legend />
                                    </PieChart>
                                  </ResponsiveContainer>
                                </Card>
                              </Col>
                            )}
                            {/* Volume Comparison Bar */}
                            {volumeData.length > 1 && (
                              <Col xs={24} md={12}>
                                <Card size="small" title="Volume Comparison" style={{ borderRadius: 10 }}>
                                  <ResponsiveContainer width="100%" height={220}>
                                    <BarChart data={volumeData}>
                                      <CartesianGrid strokeDasharray="3 3" />
                                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                                      <YAxis />
                                      <RTooltip formatter={(v) => v.toLocaleString()} />
                                      <Bar dataKey="value" fill="#52c41a" radius={[4, 4, 0, 0]}>
                                        {volumeData.map((_, i) => (
                                          <RCell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                        ))}
                                      </Bar>
                                    </BarChart>
                                  </ResponsiveContainer>
                                </Card>
                              </Col>
                            )}
                            {/* Cell Volumes (from baseline) */}
                            {cellVolumeData.length > 0 && (
                              <Col xs={24} md={cellVolumeData.length >= 2 ? 12 : 24}>
                                <Card size="small" title="Cell Volumes (Baseline)" style={{ borderRadius: 10 }}>
                                  <ResponsiveContainer width="100%" height={220}>
                                    <BarChart data={cellVolumeData}>
                                      <CartesianGrid strokeDasharray="3 3" />
                                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                      <YAxis />
                                      <RTooltip
                                        formatter={(v, _, entry) =>
                                          `${v.toLocaleString()} ${entry.payload.unit || ""}`
                                        }
                                      />
                                      <Bar dataKey="value" fill="#722ed1" radius={[4, 4, 0, 0]}>
                                        {cellVolumeData.map((_, i) => (
                                          <RCell key={i} fill={CHART_COLORS[(i + 3) % CHART_COLORS.length]} />
                                        ))}
                                      </Bar>
                                    </BarChart>
                                  </ResponsiveContainer>
                                </Card>
                              </Col>
                            )}
                            {/* Per-cell pie if 2+ cells */}
                            {cells >= 2 && cellVolumeData.length >= 2 && (
                              <Col xs={24} md={12}>
                                <Card size="small" title="Cell Volume Distribution" style={{ borderRadius: 10 }}>
                                  <ResponsiveContainer width="100%" height={220}>
                                    <PieChart>
                                      <Pie
                                        data={cellVolumeData}
                                        cx="50%"
                                        cy="50%"
                                        outerRadius={80}
                                        paddingAngle={3}
                                        dataKey="value"
                                        label={({ name, value }) =>
                                          `${name}: ${value.toLocaleString()}`
                                        }
                                      >
                                        {cellVolumeData.map((_, i) => (
                                          <RCell key={i} fill={CHART_COLORS[(i + 3) % CHART_COLORS.length]} />
                                        ))}
                                      </Pie>
                                      <RTooltip
                                        formatter={(v, _, entry) =>
                                          `${v.toLocaleString()} ${entry.payload.unit || ""}`
                                        }
                                      />
                                      <Legend />
                                    </PieChart>
                                  </ResponsiveContainer>
                                </Card>
                              </Col>
                            )}
                          </Row>
                        </>
                      )}
                    </>
                  );
                })(),
              },
              {
                key: "3",
                label: "Personnel & Monitoring",
                children: (
                  <Row gutter={[16, 8]}>
                    <Col span={12}>
                      <Text type="secondary">Target Month:</Text>{" "}
                      <Text strong>{detailModal.targetMonth || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">ENMO:</Text>{" "}
                      <Text strong>{detailModal.enmo || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">ESWM Staff:</Text>{" "}
                      <Text strong>{detailModal.eswmStaff || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Focal Person:</Text>{" "}
                      <Text strong>{detailModal.focalPerson || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">IIS Number:</Text>{" "}
                      <Text strong>{detailModal.iisNumber || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Monitoring:</Text>{" "}
                      <Text strong>
                        {detailModal.dateOfMonitoring
                          ? dayjs(detailModal.dateOfMonitoring).format(
                              "MMM DD, YYYY",
                            )
                          : "—"}
                      </Text>
                    </Col>
                    <Col span={8}>
                      <Text type="secondary">Days Prepared:</Text>{" "}
                      <Text strong>
                        {detailModal.totalDaysReportPrepared ?? "—"}
                      </Text>
                    </Col>
                    <Col span={8}>
                      <Text type="secondary">Days Staff Review:</Text>{" "}
                      <Text strong>
                        {detailModal.totalDaysReviewedStaff ?? "—"}
                      </Text>
                    </Col>
                    <Col span={8}>
                      <Text type="secondary">Days Focal Review:</Text>{" "}
                      <Text strong>
                        {detailModal.totalDaysReviewedFocal ?? "—"}
                      </Text>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "4",
                label: "Compliance",
                children: (
                  <Row gutter={[16, 8]}>
                    <Col span={24}>
                      <Text type="secondary">Remarks:</Text>{" "}
                      <Text>{detailModal.remarksAndRecommendation || "—"}</Text>
                    </Col>
                    <Col span={24}>
                      <Text type="secondary">Findings:</Text>{" "}
                      <Text>{detailModal.findings || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Advise Letter:</Text>{" "}
                      <Text>{detailModal.adviseLetterDateIssued || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Compliance:</Text>{" "}
                      <Text>{detailModal.complianceToAdvise || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Signed Document:</Text>{" "}
                      <Text>{detailModal.signedDocument || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Docket (NOV):</Text>{" "}
                      <Text>{detailModal.docketNoNOV || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">NOV Date:</Text>{" "}
                      <Text>{detailModal.dateOfIssuanceNOV || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Tech Conference:</Text>{" "}
                      <Text>
                        {detailModal.dateOfTechnicalConference || "—"}
                      </Text>
                    </Col>
                    <Col span={24}>
                      <Text type="secondary">Commitments:</Text>{" "}
                      <Text>{detailModal.commitments || "—"}</Text>
                    </Col>
                  </Row>
                ),
              },
              ...(detailModal.slfGenerator
                ? [
                    {
                      key: "5",
                      label: (
                        <>
                          <DatabaseOutlined /> Baseline Info
                        </>
                      ),
                      children: loadingBaseline ? (
                        <div style={{ textAlign: "center", padding: 32 }}>
                          <Text type="secondary">Loading baseline data...</Text>
                        </div>
                      ) : baselineData ? (
                        <>
                          <Row gutter={[16, 12]}>
                            <Col span={24}>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                Last updated:{" "}
                                {baselineData.savedAt
                                  ? dayjs(baselineData.savedAt).format("MMM DD, YYYY h:mm A")
                                  : "—"}
                              </Text>
                            </Col>
                            <Col span={12}>
                              <Card size="small" style={{ borderRadius: 8 }}>
                                <Statistic
                                  title="Total Volume Accepted"
                                  value={baselineData.totalVolumeAccepted ?? 0}
                                  suffix={(baselineData.totalVolumeAcceptedUnit || "m³").replace("m3", "m³")}
                                  precision={2}
                                />
                              </Card>
                            </Col>
                            <Col span={12}>
                              <Card size="small" style={{ borderRadius: 8 }}>
                                <Statistic
                                  title="Active Cell (Residual)"
                                  value={baselineData.activeCellResidualVolume ?? 0}
                                  suffix={(baselineData.activeCellResidualUnit || "m³").replace("m3", "m³")}
                                  precision={2}
                                />
                              </Card>
                            </Col>
                            <Col span={12}>
                              <Card size="small" style={{ borderRadius: 8 }}>
                                <Statistic
                                  title="Active Cell (Inert)"
                                  value={baselineData.activeCellInertVolume ?? 0}
                                  suffix={(baselineData.activeCellInertUnit || "m³").replace("m3", "m³")}
                                  precision={2}
                                />
                              </Card>
                            </Col>
                            <Col span={12}>
                              <Card size="small" style={{ borderRadius: 8 }}>
                                <Statistic
                                  title="Closed Cell (Residual)"
                                  value={baselineData.closedCellResidualVolume ?? 0}
                                  suffix={(baselineData.closedCellResidualUnit || "m³").replace("m3", "m³")}
                                  precision={2}
                                />
                              </Card>
                            </Col>
                            <Col span={12}>
                              <Card size="small" style={{ borderRadius: 8 }}>
                                <Statistic
                                  title="Closed Cell (Inert)"
                                  value={baselineData.closedCellInertVolume ?? 0}
                                  suffix={(baselineData.closedCellInertUnit || "m³").replace("m3", "m³")}
                                  precision={2}
                                />
                              </Card>
                            </Col>
                          </Row>
                          {baselineData.accreditedHaulers?.length > 0 && (
                            <>
                              <Divider plain orientation="left">
                                <TeamOutlined /> Accredited Haulers
                              </Divider>
                              <Table
                                dataSource={baselineData.accreditedHaulers}
                                rowKey={(_, i) => i}
                                size="small"
                                pagination={false}
                                columns={[
                                  { title: "Hauler Name", dataIndex: "haulerName", key: "haulerName" },
                                  {
                                    title: "No. of Trucks",
                                    dataIndex: "numberOfTrucks",
                                    key: "numberOfTrucks",
                                    render: (v) => v ?? "—",
                                  },
                                  {
                                    title: "Private Sector Clients",
                                    dataIndex: "privateSectorClients",
                                    key: "privateSectorClients",
                                    render: (v) => v || "—",
                                  },
                                ]}
                              />
                            </>
                          )}
                        </>
                      ) : (
                        <div style={{ textAlign: "center", padding: 32 }}>
                          <Text type="secondary">
                            No baseline data submitted yet for this SLF.
                          </Text>
                        </div>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </Modal>
    </div>
  );
}
